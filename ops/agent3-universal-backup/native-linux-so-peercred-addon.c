/*
 * Linux AF_UNIX SO_PEERCRED read primitive for Agent 3 Native v3.
 *
 * REVIEW CANDIDATE / SOURCE ONLY. This file is NOT a production binding,
 * service, installer or authorization. The Root owner must separately
 * verify immutable binary provenance and bind it only to an actual accepted
 * server-owned AF_UNIX net.Socket, before deploying.
 *
 * No caller-provided identity fields, network input, token or environment
 * value are accepted. Node-API only accepts an open FD number. Never expose
 * this API as an MCP or HTTP method; the reviewed Root owner must hold it.
 */
#define _GNU_SOURCE
#include <node_api.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>
#include <stdint.h>
#include <math.h>

static napi_value deny(napi_env env, const char *reason) {
  (void)napi_throw_error(env, NULL, reason);
  return NULL;
}

static napi_value read_peer_credentials(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok ||
      argc != 1)
    return deny(env, "peercred_exactly_one_fd_required");

  napi_valuetype type;
  if (napi_typeof(env, argv[0], &type) != napi_ok ||
      type != napi_number)
    return deny(env, "peercred_integer_fd_required");

  double numeric_fd = -1;
  if (napi_get_value_double(env, argv[0], &numeric_fd) != napi_ok ||
      !isfinite(numeric_fd) || numeric_fd < 0 ||
      numeric_fd > 2147483647.0 ||
      floor(numeric_fd) != numeric_fd)
    return deny(env, "peercred_integer_fd_required");
  int fd = (int)numeric_fd;

  struct stat st;
  if (fstat(fd, &st) != 0 || !S_ISSOCK(st.st_mode))
    return deny(env, "peercred_socket_fd_required");

  int domain = 0;
  socklen_t length = (socklen_t)sizeof(domain);
  if (getsockopt(fd, SOL_SOCKET, SO_DOMAIN, &domain, &length) != 0 ||
      length != sizeof(domain) || domain != AF_UNIX)
    return deny(env, "peercred_unix_socket_required");

  int type_of_socket = 0;
  length = (socklen_t)sizeof(type_of_socket);
  if (getsockopt(fd, SOL_SOCKET, SO_TYPE,
                 &type_of_socket, &length) != 0 ||
      length != sizeof(type_of_socket) ||
      type_of_socket != SOCK_STREAM)
    return deny(env, "peercred_unix_stream_required");

  int is_listener = -1;
  length = (socklen_t)sizeof(is_listener);
  if (getsockopt(fd, SOL_SOCKET, SO_ACCEPTCONN, &is_listener, &length) != 0 ||
      length != sizeof(is_listener) || is_listener != 0)
    return deny(env, "peercred_accepted_connection_required");

  struct sockaddr_un peer;
  length = (socklen_t)sizeof(peer);
  if (getpeername(fd, (struct sockaddr *)&peer, &length) != 0 ||
      peer.sun_family != AF_UNIX)
    return deny(env, "peercred_connected_unix_peer_required");

  struct ucred cred;
  length = (socklen_t)sizeof(cred);
  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &length) != 0 ||
      length != sizeof(cred) || cred.pid <= 0 ||
      cred.uid == (uid_t)-1 || cred.gid == (gid_t)-1)
    return deny(env, "peercred_kernel_query_failed");

  napi_value result, pid, uid, gid;
  if (napi_create_object(env, &result) != napi_ok ||
      napi_create_int64(env, (int64_t)cred.pid, &pid) != napi_ok ||
      napi_create_uint32(env, (uint32_t)cred.uid, &uid) != napi_ok ||
      napi_create_uint32(env, (uint32_t)cred.gid, &gid) != napi_ok ||
      napi_set_named_property(env, result, "pid", pid) != napi_ok ||
      napi_set_named_property(env, result, "uid", uid) != napi_ok ||
      napi_set_named_property(env, result, "gid", gid) != napi_ok)
    return deny(env, "peercred_napi_conversion_failed");
  return result;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "readPeerCredentials", NAPI_AUTO_LENGTH,
                           read_peer_credentials, NULL, &fn) != napi_ok ||
      napi_set_named_property(env, exports,
                              "readPeerCredentials", fn) != napi_ok)
    return deny(env, "peercred_napi_initialization_failed");
  return exports;
}

NAPI_MODULE(agent3_native_v3_so_peercred_candidate, initialize)
