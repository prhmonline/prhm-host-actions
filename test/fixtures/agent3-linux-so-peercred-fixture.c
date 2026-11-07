/*
 * Linux SO_PEERCRED test fixture for Agent 3 PR #212.
 * TEST-ONLY Node-API module, not a production loader or security authority.
 * Do not install, ship, or invoke as a Root Executor approval/installer.
 * Its only job is to read peer credentials from an already-accepted fd
 * supplied by the same-process CI test, never from an HTTP body or header.
 */
#define _GNU_SOURCE
#include <node_api.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <stdint.h>

static napi_value fail(napi_env env, const char *reason) {
  (void)napi_throw_error(env, NULL, reason);
  return NULL;
}

static napi_value read_peercred(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok ||
      argc != 1) return fail(env, "peercred_one_fd_required");
  napi_valuetype type;
  if (napi_typeof(env, argv[0], &type) != napi_ok ||
      type != napi_number) return fail(env, "peercred_integer_fd_required");
  int32_t fd = -1;
  if (napi_get_value_int32(env, argv[0], &fd) != napi_ok ||
      fd < 0) return fail(env, "peercred_invalid_fd");

  struct ucred cred;
  socklen_t len = (socklen_t)sizeof(cred);
  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) != 0 ||
      len != sizeof(cred) || cred.pid <= 0 ||
      cred.uid == (uid_t)-1 || cred.gid == (gid_t)-1)
    return fail(env, "peercred_kernel_query_failed");

  napi_value result, pid, uid, gid;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_int64(env, (int64_t)cred.pid, &pid) != napi_ok ||
      napi_create_uint32(env, (uint32_t)cred.uid, &uid) != napi_ok ||
      napi_create_uint32(env, (uint32_t)cred.gid, &gid) != napi_ok ||
      napi_set_named_property(env, result, "pid", pid) != napi_ok ||
      napi_set_named_property(env, result, "uid", uid) != napi_ok ||
      napi_set_named_property(env, result, "gid", gid) != napi_ok)
    return fail(env, "peercred_napi_conversion_failed");
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "readPeerCredentials", NAPI_AUTO_LENGTH,
                           read_peercred, NULL, &fn) != napi_ok ||
      napi_set_named_property(env, exports, "readPeerCredentials", fn) != napi_ok)
    return fail(env, "peercred_napi_init_failed");
  return exports;
}
NAPI_MODULE(agent3_linux_peercred_test_fixture, init)
