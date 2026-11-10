import copy
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
        self.assertIn("sys.argv[1:] == ['--preview']", source)
        self.assertNotIn('open(POLICY, "wb")', source)
        self.assertNotIn('subprocess', source)
        self.assertNotIn('CREATE USER', source)
        self.assertNotIn('mysql.cnf', source)
        self.assertNotIn('--apply', source)


if __name__ == '__main__':
    unittest.main()
