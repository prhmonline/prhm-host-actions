import copy
import io
import sys
from unittest.mock import patch
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
PATH = ROOT / 'scripts' / 'u06' / 'u06_l4_policy_candidate_preview_v1.py'
spec = importlib.util.spec_from_file_location('u06_preview', str(PATH))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture():
    return {
        'schema_version': 'prhm.approval-policy.v1',
        'default_deny': True,
        'scope_freeze': True,
        'one_time_use': True,
        'issuer': 'prhm-company-approval',
        'version': '2026-11-11.1-test',
        'levels': {'4': {'human_approval': True,
                         'second_confirmation_required': True,
                         'max_ttl_seconds': 180}},
        'operations': {
            'host_action.old_action_v1': {'level': 3, 'risk': 'high'}
        },
        'typed_scopes': [{
            'tool': 'host_action_v2_apply',
            'project': 'control_plane',
            'environment': 'production',
            'action': 'old_action_v1',
            'risk': 'high',
            'operation': 'host_action.old_action_v1',
            'principals': [{'principal_id': 'mohammad',
                            'roles': ['mcp-operator']}]
        }],
        'other_config': {'must_remain': ['byte-for-byte-same-values']}
    }


class CandidateTests(unittest.TestCase):
    def test_exact_additive_level4_and_original_unchanged(self):
        original = fixture()
        before = copy.deepcopy(original)
        result = module.candidate(original)
        self.assertEqual(original, before)
        self.assertEqual(len(result['operations']), len(original['operations']) + 1)
        self.assertEqual(len(result['typed_scopes']), len(original['typed_scopes']) + 1)
        self.assertEqual(result['operations']['host_action.old_action_v1'],
                         original['operations']['host_action.old_action_v1'])
        self.assertEqual(result['typed_scopes'][0], original['typed_scopes'][0])
        self.assertEqual(result['other_config'], original['other_config'])
        op = result['operations'][module.OPERATION]
        self.assertEqual(op['level'], 4)
        self.assertEqual(op['risk'], 'critical')
        self.assertEqual(op['expires_seconds'], 180)
        self.assertEqual(op['requested_approver'], 'mohammad')
        self.assertTrue(op['requires_second_confirmation'])
        sc = result['typed_scopes'][-1]
        self.assertEqual(sc['action'], module.ACTION)
        self.assertEqual(sc['operation'], module.OPERATION)
        self.assertEqual(sc['principals'],
                         [{'principal_id': 'mohammad',
                           'roles': ['mcp-operator']}])

    def test_deterministic_bytes_and_digests(self):
        one = module.candidate(fixture())
        two = module.candidate(fixture())
        a = (json.dumps(one, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        b = (json.dumps(two, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        self.assertEqual(a, b)
        self.assertEqual(module.sha(a), module.sha(b))
        self.assertEqual(len(module.sha(a)), 64)

    def test_missing_root_policy_guards_fail(self):
        for patch in [
            {'default_deny': False}, {'scope_freeze': False},
            {'one_time_use': False}, {'issuer': 'fake'},
            {'schema_version': 'other'}
        ]:
            p = fixture()
            p.update(patch)
            with self.assertRaises(ValueError):
                module.candidate(p)

    def test_level4_downgrade_and_duplicate_action_rejected(self):
        p = fixture()
        p['levels']['4']['human_approval'] = False
        with self.assertRaises(ValueError):
            module.candidate(p)
        p = fixture()
        p['operations'][module.OPERATION] = {'level': 3}
        with self.assertRaises(ValueError):
            module.candidate(p)
        p = fixture()
        p['typed_scopes'].append({'action': module.ACTION,
                                  'operation': 'different'})
        with self.assertRaises(ValueError):
            module.candidate(p)

    def test_no_runtime_apply_mode_or_credential_content(self):
        source = PATH.read_text(encoding='utf-8')
        self.assertIn("sys.argv[1:] in (['--preview'], ['--audit-all'])", source)
        self.assertNotIn('open(POLICY, "wb")', source)
        self.assertNotIn('subprocess', source)
        self.assertNotIn('CREATE USER', source)
        self.assertNotIn('mysql.cnf', source)
        self.assertNotIn('--apply', source)


def route_fixture():
    api = (
        "const HOST_ACTION_V2_SPECS=Object.freeze({\n" +
        module.API_REGISTRY +
        "\n});\nconst HOST_ACTION_V2_LEVEL3 = new Set(['host_action_v2_installer_v1']);\n" +
        "function hostActionV2ApprovalMeta(action){return 4;}\n"
    )
    executor = (
        "const HOST_ACTION_V2_SPECS=Object.freeze({\n" +
        module.EXEC_REGISTRY + "\n});\n" +
        module.AUTH_CONSUME + "\n" + module.EXEC_APPLY + "\n" +
        "const h={host_actions_v2: Object.keys(HOST_ACTION_V2_SPECS)};\n" +
        module.ROOT_DISPATCH + "return legacyAction(action);};\n"
    )
    mcp = module.MC_ENUM + "'host_action_v2_installer_v1']);\n"
    return { 'agent_api': api.encode('utf-8'),
             'root_executor': executor.encode('utf-8'),
             'agent3_mcp': mcp.encode('utf-8') }


class JoinedPolicyAndRootTests(unittest.TestCase):
    def test_actual_owner_report_pins_and_fixed_sha(self):
        self.assertEqual(module.EXPECTED_CANDIDATE_SHA256,
                         'aa1563b168aea2725a0539373c54c45b2317b6320334c80a6d3a5e2723520934')
        self.assertEqual(module.EXPECTED_CANDIDATE_SIZE, 32036)
        self.assertEqual(set(module.OWNER_SOURCES),
                         {'agent_api', 'root_executor', 'agent3_mcp'})
        self.assertEqual(module.OWNER_SOURCES['agent_api'][2], 34605)
        self.assertEqual(module.OWNER_SOURCES['root_executor'][2], 115918)
        self.assertEqual(module.OWNER_SOURCES['agent3_mcp'][2], 12321)

    def test_synthetic_routes_deny_dispatch_and_preserve_auth_order(self):
        sample = route_fixture()
        before = {k: bytes(v) for k, v in sample.items()}
        report = module.audit_routes(sample)
        self.assertEqual(set(report), set(sample))
        self.assertTrue(all(len(x) == 64 for x in report.values()))
        self.assertEqual(sample, before)
        expected = sample['root_executor'].decode('utf-8').replace(
            module.EXEC_REGISTRY,
            module.NEW_EXEC + '\n' + module.EXEC_REGISTRY
        ).replace(module.ROOT_DISPATCH,
                  module.ROOT_DISPATCH + module.DENY)
        self.assertEqual(report['root_executor'],
                         module.sha(expected.encode('utf-8')))
        self.assertIn("native_root_dispatch_not_installed", expected)
        self.assertLess(expected.index(module.AUTH_CONSUME),
                        expected.index(module.EXEC_APPLY))

    def test_wrong_or_duplicate_route_anchor_rejected(self):
        for key, needle in [('agent_api', module.API_REGISTRY),
                            ('root_executor', module.EXEC_REGISTRY),
                            ('agent3_mcp', module.MC_ENUM),
                            ('root_executor', module.ROOT_DISPATCH)]:
            orig = route_fixture()
            orig[key] = orig[key].replace(
                needle.encode('utf-8'), b'WRONG'
            )
            with self.assertRaises(ValueError):
                module.audit_routes(orig)
            orig = route_fixture()
            orig[key] += needle.encode('utf-8')
            with self.assertRaises(ValueError):
                module.audit_routes(orig)

    def test_deny_level3_promotion_and_action_replay(self):
        files = route_fixture()
        files['agent_api'] = files['agent_api'].replace(
            b"new Set(['host_action_v2_installer_v1'])",
            b"new Set(['honartik_u06_native_backup_register_v1'])"
        )
        with self.assertRaises(ValueError):
            module.audit_routes(files)
        files = route_fixture()
        files['agent3_mcp'] += module.ACTION.encode('utf-8')
        with self.assertRaises(ValueError):
            module.audit_routes(files)

    def test_approval_must_be_consumed_before_dispatch(self):
        files = route_fixture()
        original = files['root_executor'].decode('utf-8')
        reordered = original.replace(
            module.AUTH_CONSUME + '\n' + module.EXEC_APPLY,
            module.EXEC_APPLY + '\n' + module.AUTH_CONSUME
        )
        files['root_executor'] = reordered.encode('utf-8')
        with self.assertRaises(ValueError):
            module.audit_routes(files)

    def test_read_only_no_install_or_secret_transport(self):
        script = PATH.read_text(encoding='utf-8')
        self.assertIn("sys.argv[1:] in (['--preview'], ['--audit-all'])",
                      script)
        self.assertNotIn('subprocess', script)
        self.assertNotIn('os.rename(', script)
        self.assertNotIn('os.replace(', script)
        self.assertNotIn('--apply', script)
        self.assertNotIn('CREATE USER', script)
        self.assertNotIn('mysql.cnf', script)


class ActualEntrypointRegressionTests(unittest.TestCase):
    """Run main(), not just candidate(): catches undefined st runtime regressions."""

    @staticmethod
    def fake_production_policy_bytes():
        # Match the exact 31,167-byte root file preimage length with valid
        # fixture JSON plus whitespace, never read a live policy.
        data = json.dumps(fixture(), ensure_ascii=False).encode('utf-8')
        assert len(data) < 31167
        return data + b' ' * (31167 - len(data))

    def execute_mode(self, flag):
        raw = self.fake_production_policy_bytes()
        expected_policy = module.candidate(json.loads(raw.decode('utf-8')))
        expected_candidate = (
            json.dumps(expected_policy, ensure_ascii=False, indent=2) + '\n'
        ).encode('utf-8')
        checked_paths = []

        def fake_exact_read(path, expected_sha, size, mode):
            self.assertEqual(path, module.POLICY)
            self.assertEqual(expected_sha, module.sha(raw))
            self.assertEqual(size, 31167)
            self.assertEqual(mode, 0o644)
            checked_paths.append(path)
            return raw

        stream = io.StringIO()
        with patch.object(module, 'PINNED', module.sha(raw)), \
                patch.object(module, 'EXPECTED_CANDIDATE_SHA256',
                             module.sha(expected_candidate)), \
                patch.object(module, 'EXPECTED_CANDIDATE_SIZE',
                             len(expected_candidate)), \
                patch.object(module, 'read_exact_root',
                             side_effect=fake_exact_read), \
                patch.object(module.socket, 'getfqdn', return_value=module.HOST), \
                patch.object(sys, 'argv', ['u06.py', flag]), \
                patch('sys.stdout', stream), \
                patch.object(module, 'inspect_all_routes',
                             return_value={'fixture_verified': True}) as inspect:
            module.main()

        result = json.loads(stream.getvalue())
        self.assertEqual(len(checked_paths), 2, 'read and recheck exact policy')
        self.assertEqual(result['candidate_sha256'], module.sha(expected_candidate))
        self.assertTrue(result['owner_confirmed_sha_bound'])
        self.assertFalse(result['live_policy_modified'])
        self.assertFalse(result['action_registered'])
        self.assertFalse(result['root_executor_installed'])
        self.assertFalse(result['prod_db_mutated'])
        if flag == '--audit-all':
            inspect.assert_called_once_with()
            self.assertEqual(result['four_owner_inmemory_preview'],
                             {'fixture_verified': True})
        else:
            inspect.assert_not_called()

    def test_main_preview_entrypoint_without_old_st(self):
        self.execute_mode('--preview')

    def test_main_audit_all_entrypoint_without_old_st(self):
        self.execute_mode('--audit-all')

    def test_main_rejects_policy_length_or_sha_drift(self):
        raw = self.fake_production_policy_bytes()
        for bad in (raw[:-1], raw[:-1] + b'X'):
            with patch.object(module, 'read_exact_root', return_value=bad), \
                    patch.object(module, 'PINNED', module.sha(raw)), \
                    patch.object(module.socket, 'getfqdn', return_value=module.HOST), \
                    patch.object(sys, 'argv', ['u06.py', '--audit-all']):
                with self.assertRaises(ValueError):
                    module.main()

    def test_undefined_st_name_never_in_entrypoint(self):
        source = PATH.read_text(encoding='utf-8')
        self.assertNotIn('st.st_size', source)


if __name__ == '__main__':
    unittest.main()
