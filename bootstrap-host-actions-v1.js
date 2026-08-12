'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const PATHS = Object.freeze({
  policy: '/opt/prhm-company-control-plane/config/approval-policy.json',
  base: '/opt/prhm-agent-selfmaint/server.js',
  exec: '/opt/prhm-agent-selfmaint-exec/server.js',
  mcp: '/home/agent/ssh-mcp-server/src/plugins/selfmaint.js',
  execDropinDir: '/etc/systemd/system/prhm-agent-selfmaint-exec.service.d',
  execDropin: '/etc/systemd/system/prhm-agent-selfmaint-exec.service.d/90-host-actions-v1.conf',
  targetDropinDir: '/etc/systemd/system/prhm-agent-api.service.d',
  marker: '/var/lib/prhm-agent-selfmaint-exec/host-actions-v1-bootstrap.json'
});

const EXPECTED = Object.freeze({
  policy: '0b841879c7e63f60628c8df377038f88de8feb52ffe2462782eaaf44a629e2b1',
  base: 'd28029d952809b643ee9796cd0be05f230c9a74b1050fe43952507f51ed2f4fb',
  exec: 'c8e83f6f2c5fbc53882eae5d4344e492a7c9d050b35d68fdd439a2ad292e53f8',
  mcp: '513411bd8c9ab1c5aba6cce0d23f41d8f24e3a50bb614cb45d3123c6ec0b2fc8'
});

const SERVICES = Object.freeze([
  'prhm-company-approval.service',
  'prhm-agent-selfmaint.service',
  'prhm-agent-selfmaint-exec.service',
  'prhm-agent-mcp.service'
]);

const INJECT = Object.freeze({
  base_constants: Buffer.from('Y29uc3QgT1BFUkFUSU9OID0gJ3NlbGZtYWludC5wYXRjaF9jb250cm9sX3BsYW5lJzsKY29uc3QgSE9TVF9BQ1RJT05TX1YxX0JBU0VfTUFSS0VSID0gdHJ1ZTsKY29uc3QgSE9TVF9BQ1RJT05fT1BFUkFUSU9OID0gJ2hvc3RfYWN0aW9uLmhhcmRlbl9hZ2VudF9hcGlfdjEnOwpjb25zdCBIT1NUX0FDVElPTl9OQU1FID0gJ2hhcmRlbl9hZ2VudF9hcGlfdjEnOwpjb25zdCBIT1NUX0FDVElPTl9ST0xMQkFDSyA9ICdob3N0LWFjdGlvbjpoYXJkZW4tYWdlbnQtYXBpLXYxOmF1dG8tYmFja3VwJzs=', 'base64').toString('utf8'),
  base_routes: Buffer.from('ICAgIGlmIChyZXEubWV0aG9kID09PSAnUE9TVCcgJiYgcmVxLnVybCA9PT0gJy92MS9ob3N0LWFjdGlvbnMvcmVxdWVzdCcpIHsKICAgICAgY29uc3QgaW5wdXQgPSBhd2FpdCByZWFkQm9keShyZXEpOwogICAgICBpZiAoIWlucHV0IHx8IHR5cGVvZiBpbnB1dCAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShpbnB1dCkgfHwKICAgICAgICAgIE9iamVjdC5rZXlzKGlucHV0KS5sZW5ndGggIT09IDEgfHwgU3RyaW5nKGlucHV0LmFjdGlvbiB8fCAnJykgIT09IEhPU1RfQUNUSU9OX05BTUUpIHsKICAgICAgICB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcignaG9zdF9hY3Rpb25fbm90X2FsbG93ZWQnKSwgeyBzdGF0dXM6IDQwMCB9KTsKICAgICAgfQogICAgICBjb25zdCBlbnYgPSByZWFkRW52RmlsZShBUFBST1ZBTF9DTElFTlRfRU5WKTsKICAgICAgaWYgKCFlbnYuQVBQUk9WQUxfUkVRVUVTVF9UT0tFTikgdGhyb3cgbmV3IEVycm9yKCdhcHByb3ZhbF9yZXF1ZXN0X3Rva2VuX21pc3NpbmcnKTsKICAgICAgY29uc3QgYXJncyA9IHsgYWN0aW9uOiBIT1NUX0FDVElPTl9OQU1FIH07CiAgICAgIGNvbnN0IGFyZ0hhc2ggPSBhcmd1bWVudHNTaGEyNTYoYXJncyk7CiAgICAgIGNvbnN0IHJlc3VsdCA9IGFwcHJvdmFsSHR0cCgnUE9TVCcsICcvdjEvcmVxdWVzdHMnLCBlbnYuQVBQUk9WQUxfUkVRVUVTVF9UT0tFTiwgewogICAgICAgIHByaW5jaXBhbF9pZDogJ21vaGFtbWFkJywKICAgICAgICByb2xlOiAnbWNwLW9wZXJhdG9yJywKICAgICAgICB0b29sOiAnaG9zdF9hY3Rpb25fYXBwbHknLAogICAgICAgIHByb2plY3Q6ICdjb250cm9sX3BsYW5lJywKICAgICAgICBlbnZpcm9ubWVudDogJ3Byb2R1Y3Rpb24nLAogICAgICAgIGFjdGlvbjogSE9TVF9BQ1RJT05fTkFNRSwKICAgICAgICByaXNrOiAnY3JpdGljYWwnLAogICAgICAgIG9wZXJhdGlvbjogSE9TVF9BQ1RJT05fT1BFUkFUSU9OLAogICAgICAgIGFyZ3VtZW50czogYXJncywKICAgICAgICBhcmd1bWVudHNfc2hhMjU2OiBhcmdIYXNoLAogICAgICAgIHR0bF9zZWNvbmRzOiAxODAsCiAgICAgICAgcm9sbGJhY2tfcmVmZXJlbmNlOiBIT1NUX0FDVElPTl9ST0xMQkFDSwogICAgICB9KTsKICAgICAgY29uc3QgcmVxdWVzdCA9IHJlc3VsdC5yZXF1ZXN0IHx8IHt9OwogICAgICBpZiAoIXJlcXVlc3QucmVxdWVzdF9pZCB8fAogICAgICAgICAgTnVtYmVyKHJlcXVlc3QubGV2ZWwpICE9PSA0IHx8CiAgICAgICAgICBTdHJpbmcocmVxdWVzdC5hY3Rpb24gfHwgJycpICE9PSBIT1NUX0FDVElPTl9OQU1FIHx8CiAgICAgICAgICBTdHJpbmcocmVxdWVzdC5hcmd1bWVudHNfc2hhMjU2IHx8ICcnKSAhPT0gYXJnSGFzaCkgewogICAgICAgIHRocm93IE9iamVjdC5hc3NpZ24obmV3IEVycm9yKCdob3N0X2FjdGlvbl9yZXF1ZXN0X2JpbmRpbmdfbWlzbWF0Y2gnKSwgeyBzdGF0dXM6IDQwOSB9KTsKICAgICAgfQogICAgICByZXR1cm4gc2VuZChyZXMsIDIwMSwgewogICAgICAgIG9rOiB0cnVlLAogICAgICAgIHJlcXVlc3QsCiAgICAgICAgYWN0aW9uOiBIT1NUX0FDVElPTl9OQU1FLAogICAgICAgIGFyZ3VtZW50c19zaGEyNTY6IGFyZ0hhc2gKICAgICAgfSk7CiAgICB9CgogICAgaWYgKHJlcS5tZXRob2QgPT09ICdQT1NUJyAmJiByZXEudXJsID09PSAnL3YxL2hvc3QtYWN0aW9ucy9jb25maXJtJykgewogICAgICBjb25zdCBpbnB1dCA9IGF3YWl0IHJlYWRCb2R5KHJlcSk7CiAgICAgIGNvbnN0IGFsbG93ZWQgPSBuZXcgU2V0KFsncmVxdWVzdF9pZCcsICdhY3Rpb24nLCAnc2Vjb25kX2NvbmZpcm1hdGlvbicsICdub3RlJ10pOwogICAgICBpZiAoIWlucHV0IHx8IHR5cGVvZiBpbnB1dCAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShpbnB1dCkpIHsKICAgICAgICB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcignaW52YWxpZF9ob3N0X2FjdGlvbl9jb25maXJtX2JvZHknKSwgeyBzdGF0dXM6IDQwMCB9KTsKICAgICAgfQogICAgICBmb3IgKGNvbnN0IGtleSBvZiBPYmplY3Qua2V5cyhpbnB1dCkpIHsKICAgICAgICBpZiAoIWFsbG93ZWQuaGFzKGtleSkpIHRocm93IE9iamVjdC5hc3NpZ24obmV3IEVycm9yKCdob3N0X2FjdGlvbl9jb25maXJtX2ZpZWxkX25vdF9hbGxvd2VkOicgKyBrZXkpLCB7IHN0YXR1czogNDAwIH0pOwogICAgICB9CiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IFN0cmluZyhpbnB1dC5yZXF1ZXN0X2lkIHx8ICcnKTsKICAgICAgaWYgKCEvXlswLTlhLWYtXXszNn0kL2kudGVzdChyZXF1ZXN0SWQpKSB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcignaW52YWxpZF9yZXF1ZXN0X2lkJyksIHsgc3RhdHVzOiA0MDAgfSk7CiAgICAgIGlmIChTdHJpbmcoaW5wdXQuYWN0aW9uIHx8ICcnKSAhPT0gSE9TVF9BQ1RJT05fTkFNRSkgdGhyb3cgT2JqZWN0LmFzc2lnbihuZXcgRXJyb3IoJ2hvc3RfYWN0aW9uX25vdF9hbGxvd2VkJyksIHsgc3RhdHVzOiA0MDAgfSk7CiAgICAgIGlmIChTdHJpbmcoaW5wdXQuc2Vjb25kX2NvbmZpcm1hdGlvbiB8fCAnJykgIT09IENPTkZJUk1fTElURVJBTCkgewogICAgICAgIHRocm93IE9iamVjdC5hc3NpZ24obmV3IEVycm9yKCdjcml0aWNhbF9zZWNvbmRfY29uZmlybWF0aW9uX3JlcXVpcmVkJyksIHsgc3RhdHVzOiA0MDkgfSk7CiAgICAgIH0KICAgICAgY29uc3QgZW52ID0gcmVhZEVudkZpbGUoQVBQUk9WQUxfQ0xJRU5UX0VOVik7CiAgICAgIGlmICghZW52LkFQUFJPVkFMX0RFQ0lTSU9OX1RPS0VOKSB0aHJvdyBuZXcgRXJyb3IoJ2FwcHJvdmFsX2RlY2lzaW9uX3Rva2VuX21pc3NpbmcnKTsKICAgICAgY29uc3QgcmVzdWx0ID0gYXBwcm92YWxIdHRwKAogICAgICAgICdQT1NUJywKICAgICAgICAnL3YxL3JlcXVlc3RzLycgKyByZXF1ZXN0SWQgKyAnL2RlY2lzaW9uJywKICAgICAgICBlbnYuQVBQUk9WQUxfREVDSVNJT05fVE9LRU4sCiAgICAgICAgewogICAgICAgICAgZGVjaXNpb246ICdhY2NlcHQnLAogICAgICAgICAgc2Vjb25kX2NvbmZpcm1hdGlvbjogQ09ORklSTV9MSVRFUkFMLAogICAgICAgICAgcm9sbGJhY2tfcmVmZXJlbmNlOiBIT1NUX0FDVElPTl9ST0xMQkFDSywKICAgICAgICAgIG5vdGU6IFN0cmluZyhpbnB1dC5ub3RlIHx8ICdBcHByb3ZlZCBmaXhlZCBIb3N0IEFjdGlvbnMgdjEgaGFyZGVuaW5nIGFjdGlvbicpCiAgICAgICAgfQogICAgICApOwogICAgICBjb25zdCBhcHByb3ZhbCA9IHJlc3VsdC5hcHByb3ZhbCB8fCB7fTsKICAgICAgY29uc3QgdG9rZW4gPSBTdHJpbmcocmVzdWx0LmFwcHJvdmFsX3Rva2VuIHx8IHJlc3VsdC50b2tlbiB8fCBhcHByb3ZhbC50b2tlbiB8fCAnJyk7CiAgICAgIGNvbnN0IGFyZ0hhc2ggPSBhcmd1bWVudHNTaGEyNTYoeyBhY3Rpb246IEhPU1RfQUNUSU9OX05BTUUgfSk7CiAgICAgIGlmICh0b2tlbi5sZW5ndGggPCAzMiB8fCB0b2tlbi5sZW5ndGggPiAxNjM4NCkgdGhyb3cgT2JqZWN0LmFzc2lnbihuZXcgRXJyb3IoJ2FwcHJvdmFsX3Rva2VuX25vdF9yZXR1cm5lZCcpLCB7IHN0YXR1czogNTAyIH0pOwogICAgICBpZiAoYXBwcm92YWwuZXhlY3V0aW9uX2F1dGhvcml6ZWQgIT09IHRydWUpIHRocm93IE9iamVjdC5hc3NpZ24obmV3IEVycm9yKCdhcHByb3ZhbF9ub3RfZXhlY3V0aW9uX2F1dGhvcml6ZWQnKSwgeyBzdGF0dXM6IDQwOSB9KTsKICAgICAgaWYgKGFwcHJvdmFsLmFjdGlvbiAmJiBTdHJpbmcoYXBwcm92YWwuYWN0aW9uKSAhPT0gSE9TVF9BQ1RJT05fTkFNRSkgdGhyb3cgT2JqZWN0LmFzc2lnbihuZXcgRXJyb3IoJ2FwcHJvdmFsX2FjdGlvbl9taXNtYXRjaCcpLCB7IHN0YXR1czogNDA5IH0pOwogICAgICBpZiAoYXBwcm92YWwuYXJndW1lbnRzX3NoYTI1NiAmJiBTdHJpbmcoYXBwcm92YWwuYXJndW1lbnRzX3NoYTI1NikgIT09IGFyZ0hhc2gpIHRocm93IE9iamVjdC5hc3NpZ24obmV3IEVycm9yKCdhcHByb3ZhbF9hcmd1bWVudHNfaGFzaF9taXNtYXRjaCcpLCB7IHN0YXR1czogNDA5IH0pOwogICAgICByZXR1cm4gc2VuZChyZXMsIDIwMCwgewogICAgICAgIG9rOiB0cnVlLAogICAgICAgIHJlcXVlc3Q6IHJlc3VsdC5yZXF1ZXN0LAogICAgICAgIGFwcHJvdmFsLAogICAgICAgIGFwcHJvdmFsX3Rva2VuOiB0b2tlbgogICAgICB9KTsKICAgIH0KCiAgICBpZiAocmVxLm1ldGhvZCA9PT0gJ1BPU1QnICYmIHJlcS51cmwgPT09ICcvdjEvaG9zdC1hY3Rpb25zL2F1dGhvcml6ZS1jb25zdW1lJykgewogICAgICBjb25zdCBpbnB1dCA9IGF3YWl0IHJlYWRCb2R5KHJlcSk7CiAgICAgIGlmICghaW5wdXQgfHwgdHlwZW9mIGlucHV0ICE9PSAnb2JqZWN0JyB8fCBBcnJheS5pc0FycmF5KGlucHV0KSB8fAogICAgICAgICAgT2JqZWN0LmtleXMoaW5wdXQpLnNvbWUoayA9PiAhWydhY3Rpb24nLCAnYXBwcm92YWxfdG9rZW4nXS5pbmNsdWRlcyhrKSkpIHsKICAgICAgICB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcignaW52YWxpZF9ob3N0X2FjdGlvbl9hdXRob3JpemVfYm9keScpLCB7IHN0YXR1czogNDAwIH0pOwogICAgICB9CiAgICAgIGlmIChTdHJpbmcoaW5wdXQuYWN0aW9uIHx8ICcnKSAhPT0gSE9TVF9BQ1RJT05fTkFNRSkpdGhyb3cgT2JqZWN0LmFzc2lnbihuZXcgRXJyb3IoJ2hvc3RfYWN0aW9uX25vdF9hbGxvd2VkJyksIHsgc3RhdHVzOiA0MDAgfSk7CiAgICAgIGNvbnN0IHRva2VuID0gU3RyaW5nKGlucHV0LmFwcHJvdmFsX3Rva2VuIHx8ICcnKTsKICAgICAgaWYgKHRva2VuLmxlbmd0aCA8IDMyIHx8IHRva2VuLmxlbmd0aCA+IDE2Mzg0KSB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcignYXBwcm92YWxfdG9rZW5fcmVxdWlyZWQnKSwgeyBzdGF0dXM6IDQwMCB9KTsKICAgICAgY29uc3QgYXJnSGFzaCA9IGFyZ3VtZW50c1NoYTI1Nih7IGFjdGlvbjogSE9TVF9BQ1RJT05fTkFNRSA9fSk7CiAgICAgIGNvbnN0IGJpbmRpbmcgPSB7CiAgICAgICAgYXBwcm92YWxfdG9rZW46IHRva2VuLAogICAgICAgIHByaW5jaXBhbF9pZDogJ21vaGFtbWFkJywKICAgICAgICByb2xlOiAnbWNwLW9wZXJhdG9yJywKICAgICAgICB0b29sOiAnaG9zdF9hY3Rpb25fYXBwbHknLAogICAgICAgIHByb2plY3Q6ICdjb250cm9sX3BsYW5lJywKICAgICAgICBlbnZpcm9ubWVudDogJ3Byb2R1Y3Rpb24nLAogICAgICAgIGFjdGlvbjogSE9TVF9BQ1RJT05fTkFNRSwKICAgICAgICByaXNrOiAnY3JpdGljYWwnLAogICAgICAgIG9wZXJhdGlvbjogSE9TVF9BQ1RJT05fT1BFUkFUSU9OLAogICAgICAgIGFyZ3VtZW50c19zaGEyNTY6IGFyZ0hhc2gKICAgICAgfTsKICAgICAgY29uc3QgdmFsaWRhdGVkID0gYXdhaXQgYXBwcm92YWxCcmlkZ2UoJy92MS92YWxpZGF0ZScsIGJpbmRpbmcpOwogICAgICBpZiAodmFsaWRhdGVkLnZhbGlkICE9PSB0cnVlKSB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcignaG9zdF9hY3Rpb25fYXBwcm92YWxfdmFsaWRhdGlvbl9mYWlsZWQnKSwgeyBzdGF0dXM6IDQwOSB9KTsKICAgICAgY29uc3QgY29uc3VtZWQgPSBhd2FpdCBhcHByb3ZhbEJyaWRnZSgnL3YxL2NvbnN1bWUnLCB7CiAgICAgICAgLi4uYmluZGluZywKICAgICAgICBjb25zdW1lcjogJ3ByaG0tYWdlbnQtc2VsZm1haW50LWV4ZWMtaG9zdC1hY3Rpb25zLXYxJwogICAgICB9KTsKICAgICAgaWYgKGNvbnN1bWVkLmNvbnN1bWVkICE9PSB0cnVlKSB0aHJvdyBPYmplY3QuYXNzaWduKG5ldyBFcnJvcignaG9zdF9hY3Rpb25fYXBwcm92YWxfY29uc3VtZV9mYWlsZWQnKSwgeyBzdGF0dXM6IDQwOSB9KTsKICAgICAgcmV0dXJuIHNlbmQocmVzLCAyMDAsIHsKICAgICAgICBvazogdHJ1ZSwKICAgICAgICB2YWxpZDogdHJ1ZSwKICAgICAgICBjb25zdW1lZDogdHJ1ZSwKICAgICAgICBhY3Rpb246IEhPU1RfQUNUSU9OX05BTUUsCiAgICAgICAgYXJndW1lbnRzX3NoYTI1NjogYXJnSGFzaCwKICAgICAgICB0b2tlbl9leHBvc2VkOiBmYWxzZQogICAgICB9KTsKICAgIH0K', 'base64').toString('utf8'),
  exec_constants: Buffer.from('Y29uc3QgU09DS0VUX0dJRCA9IE51bWJlcihwcm9jZXNzLmVudi5TT0NLRVRfR0lEIHx8IDApOwpjb25zdCBIT1NUX0FDVElPTlNfVjFfRVhFQ19NQVJLRVIgPSB0cnVlOwpjb25zdCBIT1NUX0FDVElPTl9OQU1FID0gJ2hhcmRlbl9hZ2VudF9hcGlfdjEnOwpjb25zdCBIT1NUX0FDVElPTl9SRVFVRVNUX0RJUiA9IHBhdGguam9pbihEQVRBX1JPT1QsICdob3N0LWFjdGlvbi1yZXF1ZXN0cycpOwpjb25zdCBIT1NUX0FDVElPTl9KT0JfRElSID0gcGF0aC5qb2luKERBVEFfUk9PVCwgJ2hvc3QtYWN0aW9uLWpvYnMnKTsKY29uc3QgSE9TVF9BQ1RJT05fRFJPUElOX0RJUiA9ICcvZXRjL3N5c3RlbWQvc3lzdGVtL3ByaG0tYWdlbnQtYXBpLnNlcnZpY2UuZCc7CmNvbnN0IEhPU1RfQUNUSU9OX0RST1BJTiA9IHBhdGguam9pbihIT1NUX0FDVElPTl9EUk9QSU5fRElSLCAJOTAtcHJobS1oYXJkZW5pbmcuY29uZicpOwpjb25zdCBIT1NUX0FDVElPTl9CQUNLVVBfRElSID0gJy92YXIvYmFja3Vwcy9wcmhtLWhvc3QtYWN0aW9ucyc7CmNvbnN0IEhPU1RfQUNUSU9OX0NPTkZJRyA9IFsKICAnW1NlcnZpY2VdJywKICAnTm9OZXdQcml2aWxlZ2VzPXllcycsCiAgJ1ByaXZhdGVUbXA9eWVzJywKICAnUHJvdGVjdFN5c3RlbT1mdWxsJywKICAnUHJvdGVjdEhvbWU9cmVhZC1vbmx5JywKICAnUHJvdGVjdEtlcm5lbFR1bmFibGVzPXllcycsCiAgJ1Byb3RlY3RLZXJuZWxNb2R1bGVzPXllcycsCiAgJ1Byb3RlY3RLZXJuZWxMb2dzPXllcycsCiAgJ1Byb3RlY3RDb250cm9sR3JvdXBzPXllcycsCiAgJ1Jlc3RyaWN0TmFtZXNwYWNlcz15ZXMnLAogICdSZXN0cmljdFNVSURTR0lEPXllcycsCiAgJ0xvY2tQZXJzb25hbGl0eT15ZXMnLAogICdSZXN0cmljdEFkZHJlc3NGYW1pbGllcz1BRl9VTklYIEFGX0lORVQgQUZfSU5FVDYnLAogICdDYXBhYmlsaXR5Qm91bmRpbmdTZXQ9Q0FQX0NIT1dOIENBUF9EQUNfT1ZFUlJJREUgQ0FQX0RBQ19SRUFEX1NFQVJDSCBDQVBfRk9XTkVSIEdBUF9GU0VUSUQgQ0FQX0tJTEwgQ0FQX1NFVEdJRCBDQVBfU0VUVUlEIENBUF9ORVRfQklORF9TRVJWSUNFJywKICAnQW1iaWVudENhcGFiaWxpdGllcz0nLAogICdSZWFkV3JpdGVQYXRocz0tL2hvbWUvYWdlbnQvc3NoLWFnZW50LWFwaSAtL2hvbWUvYWdlbnQvc3NoLWFnZW50LXJ1bnRpbWUgLS9ob21lL3ByaG0gLS9ob21lL2hvbmFydGlrIC0vaG9tZS9kcnRhcmpvbWVoIC0vbW50L2ltb3Rpb24tcHJvZC12bScsCiAgJycKXS5qb2luKCdcbicpOw==', 'base64').toString('utf8'),
  exec_helpers: Buffer.from('CmZ1bmN0aW9uIGhvc3RBY3Rpb25SZXF1ZXN0RmlsZShpZCkgeyByZXR1cm4gcGF0aC5qb2luKEhPU1RfQUNUSU9OX1JFUVVFU1RfRElSLCBgJHtpZH0uanNvbmApOyB9CmZ1bmN0aW9uIGhvc3RBY3Rpb25Kb2JGaWxlKGlkKSB7IHJldHVybiBwYXRoLmpvaW4oSE9TVF9BQ1RJT05fSk9CX0RJUiwgYCR7aWR9Lmpzb25gKTsgfQoKZnVuY3Rpb24gbG9hZEhvc3RBY3Rpb25SZXF1ZXN0KHJlcXVlc3RJZCkgewogIGNvbnN0IGlkID0gdmFsaWRhdGVVdWlkKHJlcXVlc3RJZCk7CiAgY29uc3QgZmlsZSA9IGhvc3RBY3Rpb25SZXF1ZXN0RmlsZShpZCk7CiAgaWYgKCFmcy5leGlzdHNTeW5jKGZpbGUpKSB0aHJvdyBuZXcgRXJyb3IoJ2hvc3RfYWN0aW9uX3JlcXVlc3Rfbm90X2ZvdW5kJyk7CiAgY29uc3QgcmVjb3JkID0gcmVhZEpzb24oZmlsZSk7CiAgaWYgKHJlY29yZC5yZXF1ZXN0X2lkICE9PSBpZCB8fCByZWNvcmQuYWN0aW9uICE9PSBIT1NUX0FDVElPTl9OQU1FKSB0aHJvdyBuZXcgRXJyb3IoJ2hvc3RfYWN0aW9uX3JlcXVlc3RfYmluZGluZ19taXNtYXRjaCcpOwogIGlmICghcmVjb3JkLmV4cGlyZXNfYXQgfHwgRGF0ZS5ub3coKSA+PSBEYXRlLnBhcnNlKHJlY29yZC5leHBpcmVzX2F0KSkgewogICAgdHJ5IHsgZnMudW5saW5rU3luYyhmaWxlKTsgfSBjYXRjaCB7fQogICAgdGhyb3cgbmV3IEVycm9yKCdob3N0X2FjdGlvbl9yZXF1ZXN0X2V4cGlyZWQnKTsKICB9CiAgcmV0dXJuIHJlY29yZDsKfQoKZnVuY3Rpb24gd3JpdGVIb3N0QWN0aW9uSm9iKHJlcXVlc3RJZCwgZmllbGRzKSB7CiAgY29uc3QgZmlsZSA9IGhvc3RBY3Rpb25Kb2JGaWxlKHZhbGlkYXRlVXVpZChyZXF1ZXN0SWQpKTsKICBjb25zdCBjdXJyZW50ID0gZnMuZXhpc3RzU3luYyhmaWxlKSA/IHJlYWRKc29uKGZpbGUpIDoge307CiAgY29uc3QgbmV4dCA9IHsgLi4uY3VycmVudCwgcmVxdWVzdF9pZDogcmVxdWVzdElkLCBhY3Rpb246IEhPU1RfQUNUSU9OX05BTUUsIC4uLmZpZWxkcywgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH07CiAgYXRvbWljSnNvbihmaWxlLCBuZXh0KTsKICByZXR1cm4gbmV4dDsKfQoKZnVuY3Rpb24gZXhlY1N5c3RlbWN0bChhcmdzLCB0aW1lb3V0ID0gMzAwMDApIHsKICByZXR1cm4gY3AuZXhlY0ZpbGVTeW5jKCdzeXN0ZW1jdGwnLCBhcmdzLCB7IGVuY29kaW5nOiAndXRmOCcsIHN0ZGlvOiBbJ2lnbm9yZScsICdwaXBlJywgJ3BpcGUnXSwgdGltZW91dCB9KS50cmltKCk7Cn0KCmZ1bmN0aW9uIGF0b21pY1RleHQoZmlsZSwgdGV4dCwgbW9kZSA9IDBvNjQ0KSB7CiAgY29uc3QgdG1wID0gYCR7ZmlsZX0uJHtwcm9jZXNzLnBpZH0uJHtEYXRlLm5vdygpfS50bXBgOwogIGZzLndyaXRlRmlsZVN5bmModG1wLCB0ZXh0LCB7IGZsYWc6ICd3eCcsIG1vZGUgfSk7CiAgZnMuY2htb2RTeW5jKHRtcCwgbW9kZSk7CiAgZnMucmVuYW1lU3luYyh0bXAsIGZpbGUpOwp9CgpmdW5jdGlvbiBhZ2VudEFwaUhlYWx0aCgpIHsKICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiB7CiAgICBjb25zdCBxID0gaHR0cC5nZXQoeyBob3N0bmFtZTogJzEyNy4wLjAuMScsIHBvcnQ6IDgwOTksIHBhdGg6ICcvaGVhbHRoJywgdGltZW91dDogMjUwMCB9LCByID0+IHsKICAgICAgbGV0IGRhdGEgPSAnJzsKICAgICAgci5vbignZGF0YScsIGMgPT4geyBpZiAoZGF0YS5sZW5ndGggPCA2NTUzNikgZGF0YSArPSBjOyB9KTsKICAgICAgci5vbignZW5kJywgKCkgPT4gewogICAgICAgIGxldCBib2R5ID0ge307CiAgICAgICAgdHJ5IHsgYm9keSA9IEpTT04ucGFyc2UoZGF0YSB8fCAne30nKTsgfSBjYXRjaCB7fQogICAgICAgIHJlc29sdmUoci5zdGF0dXNDb2RlID09PSAyMDAgJiYgYm9keS5vayA9PT0gdHJ1ZSk7CiAgICAgIH0pOwogICAgfSk7CiAgICBxLm9uKCd0aW1lb3V0JywgKCkgPT4geyBxLmRlc3Ryb3koKTsgcmVzb2x2ZShmYWxzZSk7IH0pOwogICAgcS5vbignZXJyb3InLCAoKSA9PiByZXNvbHZlKGZhbHNlKSk7CiAgfSk7Cn0KCmFzeW5jIGZ1bmN0aW9uIHdhaXRBZ2VudEFwaUhlYWx0aHkoKSB7CiAgZm9yIChsZXQgaSA9IDA7IGkgPCA0MDsgaSsrKSB7CiAgICBpZiAoYXdhaXQgYWdlbnRBcGlIZWFsdGgoKSkgcmV0dXJuIHRydWU7CiAgICBhd2FpdCBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgNTAwKSk7CiAgfQogIHJldHVybiBmYWxzZTsKfQoKZnVuY3Rpb24gc3lzdGVtZFByb3AobmFtZSkgewogIHJldHVybiBleGVjU3lzdGVtY3RsKFsnc2hvdycsICdwcmhtLWFnZW50LWFwaS5zZXJ2aWNlJywgJy1wJywgbmFtZSwgJy0tdmFsdWUnXSwgMTAwMDApOwp9CgpmdW5jdGlvbiB2ZXJpZnlBZ2VudEFwaUhhcmRlbmluZygpIHsKICBjb25zdCByZXF1aXJlZCA9IHsKICAgIE5vTmV3UHJpdmlsZWdlczogJ3llcycsCiAgICBQcml2YXRlVG1wOiAneWVzJywKICAgIFByb3RlY3RTeXN0ZW06ICdmdWxsJywKICAgIFByb3RlY3RIb21lOiAncmVhZC1vbmx5JywKICAgIFByb3RlY3RLZXJuZWxUdW5hYmxlczogJ3llcycsCiAgICBQcm90ZWN0S2VybmVsTW9kdWxlczogJ3llcycsCiAgICBQcm90ZWN0S2VybmVsTG9nczogJ3llcycsCiAgICBQcm90ZWN0Q29udHJvbEdyb3VwczogJ3llcycsCiAgICBSZXN0cmljdE5hbWVzcGFjZXM6ICd5ZXMnLAogICAgUmVzdHJpY3RTVUlEU0dJRDogJ3llcycsCiAgICBMb2NrUGVyc29uYWxpdHk6ICd5ZXMnCiAgfTsKICBjb25zdCBhY3R1YWwgPSB7fTsKICBmb3IgKGNvbnN0IFtuYW1lLCBleHBlY3RlZF0gb2YgT2JqZWN0LmVudHJpZXMocmVxdWlyZWQpKSB7CiAgICBhY3R1YWxbbmFtZV0gPSBzeXN0ZW1kUHJvcChuYW1lKTsKICAgIGlmIChhY3R1YWxbbmFtZV0gIT09IGV4cGVjdGVkKSB0aHJvdyBuZXcgRXJyb3IoYGhhcmRlbmluZ19wcm9wZXJ0eV9taXNtYXRjaDok e25hbWV9OiR7YWN0dWFsW25hbWVdfTok e2V4cGVjdGVkfWApOwogIH0KICBhY3R1YWwuQ2FwYWJpbGl0eUJvdW5kaW5nU2V0ID0gc3lzdGVtZFByb3AoJ0NhcGFiaWxpdHlCb3VuZGluZ1NldCcpLnRvTG93ZXJDYXNlKCk7CiAgZm9yIChjb25zdCBibG9ja2VkIG9mIFsnY2FwX3N5c19hZG1pbicsICdjYXBfbmV0X2FkbWluJywgJ2NhcF9zeXNfbW9kdWxlJywgJ2NhcF9icGYnLCAnY2FwX3N5c19wdHJhY2UnXSkgewogICAgaWYgKGFjdHVhbC5DYXBhYmlsaXR5Qm91bmRpbmdTZXQuc3BsaXQoL1xzKy8pLmluY2x1ZGVzKGJsb2NrZWQpKSB0aHJvdyBuZXcgRXJyb3IoYGRhbmdlcm91c19jYXBhYmlsaXR5X3ByZXNlbnQ6JHtibG9ja2VkfWApOwogIH0KICBhY3R1YWwuQW1iaWVudENhcGFiaWxpdGllcyA9IHN5c3RlbWRQcm9wKCdBbWJpZW50Q2FwYWJpbGl0aWVzJyk7CiAgaWYgKGFjdHVhbC5BbWJpZW50Q2FwYWJpbGl0aWVzLnRyaW0oKSAhPT0gJycpIHRocm93IG5ldyBFcnJvcignYW1iaWVudF9jYXBhYmlsaXRpZXNfbm90X2VtcHR5Jyk7CiAgcmV0dXJuIGFjdHVhbDsKfQoKYXN5bmMgZnVuY3Rpb24gYXBwbHlIb3N0QWN0aW9uVjEoKSB7CiAgZnMubWtkaXJTeW5jKEhPU1RfQUNUSU9OX0RST1BJTl9ESVIsIHsgcmVjdXJzaXZlOiB0cnVlLCBtb2RlOiAwbzc1NSB9KTsKICBmcy5ta2RpclN5bmMoSE9TVF9BQ1RJT05fQkFDS1VQX0RJUiwgeyByZWN1cnNpdmU6IHRydWUsIG1vZGU6IDBvNzAwIH0pOwoKICBjb25zdCBzdGFtcCA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5yZXBsYWNlKC9bLTouVFpdL2csICcnKS5zbGljZSgwLCAxNCk7CiAgY29uc3QgZXhpc3RlZCA9IGZzLmV4aXN0c1N5bmMoSE9TVF9BQ1RJT05fRFJPUElOKTsKICBsZXQgYmFja3VwID0gbnVsbDsKICBpZiAoZXhpc3RlZCkgewogICAgYmFja3VwID0gcGF0aC5qb2luKEhPU1RfQUNUSU9OX0JBQ0tVUF9ESVIsIGBhZ2VudC1hcGktaGFyZGVuaW5nLSR7c3RhbXB9LmJha2ApOwogICAgZnMuY29weUZpbGVTeW5jKEhPU1RfQUNUSU9OX0RST1BJTiwgYmFja3VwLCBmcy5jb25zdGFudHMuQ09QWUZJTEVfRVhDTFMpOwogICAgZnMuY2htb2RTeW5jKGJhY2t1cCwgMG82MDApOwogIH0KCiAgbGV0IG11dGF0ZWQgPSBmYWxzZTsKICB0cnkgewogICAgYXRvbWljVGV4dChIT1NUX0FDVElPTl9EUk9QSU4sIEhPU1RfQUNUSU9OX0NPTkZJRywgMG82NDQpOwogICAgbXV0YXRlZCA9IHRydWU7CiAgICBleGVjU3lzdGVtY3RsKFsnZGFlbW9uLXJlbG9hZCddKTsKICAgIGV4ZWNTeXN0ZW1jdGwoWydyZXN0YXJ0JywgJ3ByaG0tYWdlbnQtYXBpLnNlcnZpY2UnXSk7CiAgICBpZiAoIShhd2FpdCB3YWl0QWdlbnRBcGlIZWFsdGh5KCkpKSB0aHJvdyBuZXcgRXJyb3IoJ2FnZW50X2FwaV9oZWFsdGhfZmFpbGVkX2FmdGVyX2hhcmRlbmluZycpOwogICAgY29uc3QgcHJvcGVydGllcyA9IHZlcmlmeUFnZW50QXBpSGFyZGVuaW5nKCk7CiAgICByZXR1cm4gewogICAgICBvazogdHJ1ZSwKICAgICAgYWN0aW9uOiBIT1NUX0FDVElPTl9OQU1FLAogICAgICBzZXJ2aWNlOiAncHJobS1hZ2VudC1hcGkuc2VydmljZScsCiAgICAgIGRyb3BpbjogSE9TVF9BQ1RJT05fRFJPUElOLAogICAgICBwcmV2aW91c19kcm9waW5fZXhpc3RlZDogZXhpc3RlZCwKICAgICAgYmFja3VwX3BhdGg6IGJhY2t1cCwKICAgICAgcm9sbGJhY2tfcGVyZm9ybWVkOiBmYWxzZSwKICAgICAgcHJvcGVydGllcwogICAgfTsKICB9IGNhdGNoIChlcnJvcikgewogICAgaWYgKG11dGF0ZWQpIHsKICAgICAgdHJ5IHsKICAgICAgICBpZiAoZXhpc3RlZCAmJiBiYWNrdXApIHsKICAgICAgICAgIGNvbnN0IHByZXZpb3VzID0gZnMucmVhZEZpbGVTeW5jKGJhY2t1cCk7CiAgICAgICAgICBjb25zdCB0bXAgPSBgJHtIT1NUX0FDVElPTl9EUk9QSU59LnJvbGxiYWNrLSR7cHJvY2Vzcy5waWR9LSR7RGF0ZS5ub3coKX0udG1wYDsKICAgICAgICAgIGZzLndyaXRlRmlsZVN5bmModG1wLCBwcmV2aW91cywgeyBtb2RlOiAwbzY0NCB9KTsKICAgICAgICAgIGZzLnJlbmFtZVN5bmModG1wLCBIT1NUX0FDVElPTl9EUk9QSU4pOwogICAgICAgIH0gZWxzZSB7CiAgICAgICAgICB0cnkgeyBmcy51bmxpbmtTeW5jKEhPU1RfQUNUSU9OX0RST1BJTik7IH0gY2F0Y2ggKGUpIHsgaWYgKGUuY29kZSAhPT0gJ0VOT0VOVCcpIHRocm93IGU7IH0KICAgICAgICB9CiAgICAgICAgZXhlY1N5c3RlbWN0bChbJ2RhZW1vbi1yZWxvYWQnXSk7CiAgICAgICAgZXhlY1N5c3RlbWN0bChbJ3Jlc3RhcnQnLCAncHJobS1hZ2VudC1hcGkuc2VydmljZSddKTsKICAgICAgICBpZiAoIShhd2FpdCB3YWl0QWdlbnRBcGlIZWFsdGh5KCkpKSB0aHJvdyBuZXcgRXJyb3IoJ2FnZW50X2FwaV9oZWFsdGhfZmFpbGVkX2FmdGVyX3JvbGxiYWNrJyk7CiAgICAgIH0gY2F0Y2ggKHJvbGxiYWNrRXJyb3IpIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYGhvc3RfYWN0aW9uX2ZhaWxlZF9hbmRfcm9sbGJhY2tfZmFpbGVkOiR7ZXJyb3IubWVzc2FnZX06JHtyb2xsYmFja0Vycm9yLm1lc3NhZ2V9YCk7CiAgICAgIH0KICAgIH0KICAgIHRocm93IG5ldyBFcnJvcigoYWhvc3RfYWN0aW9uX2ZhaWxlZF9yb2xsZWRfYmFjazoke2Vycm9yLm1lc3NhZ2V9YCk7CiAgfQp9Cg==', 'base64').toString('utf8'),
  exec_routes: Buffer.from('ICAgIGlmIChyZXEubWV0aG9kID09PSAnUE9TVCcgJiYgcmVxLnVybCA9PT0gJy92MS9ob3N0LWFjdGlvbnMvcmVxdWVzdCcpIHsKICAgICAgY29uc3QgaW5wdXQgPSBhd2FpdCByZWFkQm9keShyZXEpOwogICAgICBpZiAoIWlucHV0IHx8IHR5cGVvZiBpbnB1dCAhPT0gJ29iamVjdCcgfHwgQXJyYXkuaXNBcnJheShpbnB1dCkgfHwKICAgICAgICAgIE9iamVjdC5rZXlzKGlucHV0KS5sZW5ndGggIT09IDEgfHwgU3RyaW5nKGlucHV0LmFjdGlvbiB8fCAnJykgIT09IEhPU1RfQUNUSU9OX05BTUUpIHsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2hvc3RfYWN0aW9uX25vdF9hbGxvd2VkJyk7CiAgICAgIH0KICAgICAgY29uc3Qgb3V0ID0gYXdhaXQgY2FsbEJhc2UoJy92MS9ob3N0LWFjdGlvbnMvcmVxdWVzdCcsICdQT1NUJywgeyBhY3Rpb246IEhPU1RfQUNUSU9OX05BTUUgfSk7CiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IG91dD8ucmVxdWVzdD8ucmVxdWVzdF9pZDsKICAgICAgdmFsaWRhdGVVdWlkKHJlcXVlc3RJZCk7CiAgICAgIGNvbnN0IHJlY29yZCA9IHsKICAgICAgICByZXF1ZXN0X2lkOiByZXF1ZXN0SWQsCiAgICAgICAgYWN0aW9uOiBIT1NUX0FDVElPTl9OQU1FLAogICAgICAgIGFyZ3VtZW50c19zaGEyNTY6IG91dC5hcmd1bWVudHNfc2hhMjU2IHx8IG91dD8ucmVxdWVzdD8uYXJndW1lbnRzX3NoYTI1NiB8fCBudWxsLAogICAgICAgIGV4cGlyZXNfYXQ6IG91dD8ucmVxdWVzdD8uZXhwaXJlc19hdCB8fCBudWxsLAogICAgICAgIGNyZWF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKQogICAgICB9OwogICAgICBpZiAoIXJlY29yZC5hcmd1bWVudHNfc2hhMjU2IHx8ICFTSEFfUkUudGVzdChyZWNvcmQuYXJndW1lbnRzX3NoYTI1NikpIHRocm93IG5ldyBFcnJvcignaG9zdF9hY3Rpb25fYXJndW1lbnRzX2hhc2hfbWlzc2luZycpOwogICAgICBhdG9taWNKc29uKGhvc3RBY3Rpb25SZXF1ZXN0RmlsZShyZXF1ZXN0SWQpLCByZWNvcmQpOwogICAgICByZXR1cm4ganNvbihyZXMsIDIwMSwgewogICAgICAgIG9rOiB0cnVlLAogICAgICAgIHJlcXVlc3Q6IHNhbml0aXplKG91dC5yZXF1ZXN0IHx8IHt9KSwKICAgICAgICBhY3Rpb246IEhPU1RfQUNUSU9OX05BTUUsCiAgICAgICAgYXJndW1lbnRzX3NoYTI1NjogcmVjb3JkLmFyZ3VtZW50c19zaGEyNTYsCiAgICAgICAgZXhlY3V0b3I6ICdzZXJ2ZXItc2lkZS1ob3N0LWFjdGlvbnMtdjEnLAogICAgICAgIHNwZWNfZml4ZWRfc2VydmVyX3NpZGU6IHRydWUKICAgICAgfSk7CiAgICB9CgogICAgaWYgKHJlcS5tZXRob2QgPT09ICdQT1NUJyAmJiByZXEudXJsID09PSAnL3YxL2hvc3QtYWN0aW9ucy9leGVjdXRlJykgewogICAgICBjb25zdCBib2R5ID0gYXdhaXQgcmVhZEJvZHkocmVxKTsKICAgICAgY29uc3QgcmVxdWVzdElkID0gdmFsaWRhdGVVdWlkKGJvZHkucmVxdWVzdF9pZCk7CiAgICAgIGlmIChib2R5LnNlY29uZF9jb25maXJtYXRpb24gIT09IENPTkZJUk1BVElPTikgdGhyb3cgbmV3IEVycm9yKCdMZXZlbC00IGNvbmZpcm1hdGlvbiByZXF1aXJlZCcpOwogICAgICBpZiAoYm9keS5ub3RlICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBib2R5Lm5vdGUgIT09ICdzdHJpbmcnIHx8IGJvZHkubm90ZS5sZW5ndGggPCAzIHx8IGJvZHkubm90ZS5sZW5ndGggPiAxMDAwKSkgdGhyb3cgbmV3IEVycm9yKCdpbnZhbGlkX25vdGUnKTsKICAgICAgbG9hZEhvc3RBY3Rpb25SZXF1ZXN0KHJlcXVlc3RJZCk7CgogICAgICBpZiAoZnMuZXhpc3RzU3luYyhob3N0QWN0aW9uSm9iRmlsZShyZXF1ZXN0SWQpKSkgewogICAgICAgIGNvbnN0IGV4aXN0aW5nID0gcmVhZEpzb24oaG9zdEFjdGlvbkpvYkZpbGUocmVxdWVzdElkKSk7CiAgICAgICAgaWYgKGV4aXN0aW5nLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcpIHJldHVybiBqc29uKHJlcywgMjAwLCB7IG9rOiB0cnVlLCBqb2I6IHNhbml0aXplKGV4aXN0aW5nKSB9KTsKICAgICAgICBpZiAoWydjb25maXJtaW5nJywgJ2F1dGhvcml6aW5nJywgJ2FwcGx5aW5nJ10uaW5jbHVkZXMoZXhpc3Rpbmcuc3RhdHVzKSkgdGhyb3cgbmV3IEVycm9yKCdob3N0X2FjdGlvbl9hbHJlYWR5X3Byb2Nlc3NpbmcnKTsKICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2hvc3RfYWN0aW9uX3JlcXVlc3RfYWxyZWFkeV9mYWlsZWRfY3JlYXRlX25ld19yZXF1ZXN0Jyk7CiAgICAgIH0KCiAgICAgIHdyaXRlSG9zdEFjdGlvbkpvYihyZXF1ZXN0SWQsIHsgc3RhdHVzOiAnY29uZmlybWluZycsIHN0YXJ0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KTsKICAgICAgbGV0IGNvbmZpcm1lZCA9IGZhbHNlOwogICAgICBsZXQgY29uc3VtZWQgPSBmYWxzZTsKICAgICAgdHJ5IHsKICAgICAgICBjb25zdCBjb25maXJtID0gYXdhaXQgY2FsbEJhc2UoJy92MS9ob3N0LWFjdGlvbnMvY29uZmlybScsICdQT1NUJywgewogICAgICAgICAgcmVxdWVzdF9pZDogcmVxdWVzdElkLAogICAgICAgICAgYWN0aW9uOiBIT1NUX0FDVElPTl9OQU1FLAogICAgICAgICAgc2Vjb25kX2NvbmZpcm1hdGlvbjogYm9keS5zZWNvbmRfY29uZmlybWF0aW9uLAogICAgICAgICAgLi4uKGJvZHkubm90ZSA/IHsgbm90ZTogYm9keS5ub3RlIH0gOiB7fSkKICAgICAgICB9KTsKICAgICAgICBjb25zdCB0b2tlbiA9IFN0cmluZyhjb25maXJtLmFwcHJvdmFsX3Rva2VuIHx8ICcnKTsKICAgICAgICBpZiAodG9rZW4ubGVuZ3RoIDwgMzIgfHwgdG9rZW4ubGVuZ3RoID4gMTYzODQpIHRocm93IG5ldyBFcnJvcignbWlzc2luZ19zZXJ2ZXJfc2lkZV9ob3N0X2FjdGlvbl9hcHByb3ZhbF90b2tlbicpOwogICAgICAgIGNvbmZpcm1lZCA9IHRydWU7CgogICAgICAgIHdyaXRlSG9zdEFjdGlvbkpvYihyZXF1ZXN0SWQsIHsKICAgICAgICAgIHN0YXR1czogJ2F1dGhvcml6aW5nJywKICAgICAgICAgIGFwcHJvdmFsX2lkOiBjb25maXJtPy5hcHByb3ZhbD8uYXBwcm92YWxfaWQgfHwgbnVsbAogICAgICAgIH0pOwoKICAgICAgICBjb25zdCBhdXRoeiA9IGF3YWl0IGNhbGxCYXNlKCcvdjEvaG9zdC1hY3Rpb25zL2F1dGhvcml6ZS1jb25zdW1lJywgJ1BPU1QnLCB7CiAgICAgICAgICBhY3Rpb246IEhPU1RfQUNUSU9OX05BTUUsCiAgICAgICAgICBhcHByb3ZhbF90b2tlbjogdG9rZW4KICAgICAgICB9KTsKICAgICAgICBpZiAoYXV0aHoudmFsaWQgIT09IHRydWUgfHwgYXV0aHouY29uc3VtZWQgIT09IHRydWUpIHRocm93IG5ldyBFcnJvcignaG9zdF9hY3Rpb25fYXV0aG9yaXphdGlvbl9mYWlsZWQnKTsKICAgICAgICBjb25zdW1lZCA9IHRydWU7CgogICAgICAgIHdyaXRlSG9zdEFjdGlvbkpvYihyZXF1ZXN0SWQsIHsgc3RhdHVzOiAnYXBwbHlpbmcnIH0pOwogICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGFwcGx5SG9zdEFjdGlvblYxKCk7CiAgICAgICAgY29uc3Qgam9iID0gd3JpdGVIb3N0QWN0aW9uSm9iKHJlcXVlc3RJZCwgewogICAgICAgICAgc3RhdHVzOiAnc3VjY2VlZGVkJywKICAgICAgICAgIGNvbmZpcm1lZCwKICAgICAgICAgIGFwcHJvdmFsX2NvbnN1bWVkOiBjb25zdW1lZCwKICAgICAgICAgIGZpbmlzaGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksCiAgICAgICAgICByZXN1bHQKICAgICAgICB9KTsKICAgICAgICB0cnkgeyBmcy51bmxpbmtTeW5jKGhvc3RBY3Rpb25SZXF1ZXN0RmlsZShyZXF1ZXN0SWQpKTsgfSBjYXRjaCB7fQogICAgICAgIHJldHVybiBqc29uKHJlcywgMjAwLCB7IG9rOiB0cnVlLCBqb2I6IHNhbml0aXplKGpvYikgfSk7CiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7CiAgICAgICAgY29uc3Qgam9iID0gd3JpdGVIb3N0QWN0aW9uSm9iKHJlcXVlc3RJZCwgewogICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJywKICAgICAgICAgIGNvbmZpcm1lZCwKICAgICAgICAgIGFwcHJvdmFsX2NvbnN1bWVkOiBjb25zdW1lZCwKICAgICAgICAgIGZpbmlzaGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksCiAgICAgICAgICBlcnJvcjogU3RyaW5nKGVycm9yPy5tZXNzYWdlIHx8IGVycm9yKS5zbGljZSgwLCAzMDAwKQogICAgICAgIH0pOwogICAgICAgIGlmIChjb25maXJtZWQgfHwgY29uc3VtZWQpIHsKICAgICAgICAgIHRyeSB7IGZzLnVubGlua1N5bmMoaG9zdEFjdGlvblJlcXVlc3RGaWxlKHJlcXVlc3RJZCkpOyB9IGNhdGNoIHt9CiAgICAgICAgfQogICAgICAgIHJldHVybiBqc29uKHJlcywgNDA5LCB7IG9rOiBmYWxzZSwgZXJyb3I6IGpvYi5lcnJvciwgam9iOiBzYW5pdGl6ZShqb2IpIH0pOwogICAgICB9CiAgICB9CgogICAgaWYgKHJlcS5tZXRob2QgPT09ICdQT1NUJyAmJiByZXEudXJsID09PSAnL3YxL2hvc3QtYWN0aW9ucy9zdGF0dXMnKSB7CiAgICAgIGNvbnN0IGJvZHkgPSBhd2FpdCByZWFkQm9keShyZXEpOwogICAgICBjb25zdCByZXF1ZXN0SWQgPSB2YWxpZGF0ZVV1aWQoYm9keS5yZXF1ZXN0X2lkKTsKICAgICAgY29uc3QgZmlsZSA9IGhvc3RBY3Rpb25Kb2JGaWxlKHJlcXVlc3RJZCk7CiAgICAgIGlmICghZnMuZXhpc3RzU3luYyhmaWxlKSkgcmV0dXJuIGpzb24ocmVzLCA0MDQsIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2hvc3RfYWN0aW9uX3N0YXR1c19ub3RfZm91bmQnIH0pOwogICAgICByZXR1cm4ganNvbihyZXMsIDIwMCwgeyBvazogdHJ1ZSwgam9iOiBzYW5pdGl6ZShyZWFkSnNvbihmaWxlKSkgfSk7CiAgICB9Cg==', 'base64').toString('utf8'),
  mcp_tools: Buffer.from('CiAgbWNwLnJlZ2lzdGVyVG9vbCgKICAgICdob3N0X2FjdGlvbl9yZXF1ZXN0JywKICAgIHsKICAgICAgdGl0bGU6ICdSZXF1ZXN0IEZpeGVkIEhvc3QgQWN0aW9uIEFwcHJvdmFsJywKICAgICAgZGVzY3JpcHRpb246ICdDcmVhdGUgYSBMZXZlbC00IGFwcHJvdmFsIHJlcXVlc3QgZm9yIHRoZSBmaXhlZCBuYXRpdmUgaG9zdCBhY3Rpb24gaGFyZGVuX2FnZW50X2FwaV92MS4gTm8gYXJiaXRyYXJ5IHNlcnZpY2UsIHBhdGgsIG9yIGNvbW1hbmQgaW5wdXQgaXMgYWNjZXB0ZWQuJywKICAgICAgaW5wdXRTY2hlbWE6IHsgYWN0aW9uOiBIb3N0QWN0aW9uIH0sCiAgICAgIGFubm90YXRpb25zOiBSRVFVRVNUCiAgICB9LAogICAgYXN5bmMgYXJncyA9PiB0ZXh0UmVzdWx0KGF3YWl0IGNhbGxFeGVjKCcvdjEvaG9zdC1hY3Rpb25zL3JlcXVlc3QnLCAnUE9TVCcsIGFyZ3MpKQogICk7CgogIG1jcC5yZWdpc3RlclRvb2woCiAgICAnaG9zdF9hY3Rpb25fYXBwbHknLAogICAgewogICAgICB0aXRsZTogJ0FwcGx5IEFwcHJvdmVkIEZpeGVkIEhvc3QgQWN0aW9uJywKICAgICAgZGVzY3JpcHRpb246ICdBZnRlciBleHBsaWNpdCBMZXZlbC00IGNvbmZpcm1hdGlvbiwgZXhlY3V0ZSB0aGUgcHJldmlvdXNseSBhcHByb3ZlZCBmaXhlZCBuYXRpdmUgaG9zdCBoYXJkZW5pbmcgYWN0aW9uIHdpdGggYXV0b21hdGljIHJvbGxiYWNrIG9uIGZhaWx1cmUuJywKICAgICAgaW5wdXRTY2hlbWE6IHsKICAgICAgICByZXF1ZXN0X2lkOiB6LnN0cmluZygpLnV1aWQoKSwKICAgICAgICBzZWNvbmRfY29uZmlybWF0aW9uOiBDb25maXJtYXRpb24sCiAgICAgICAgbm90ZTogei5zdHJpbmcoKS5taW4oMykubWF4KDEwMDApLm9wdGlvbmFsKCkKICAgICAgfSwKICAgICAgYW5ub3RhdGlvbnM6IEFQUExZCiAgICB9LAogICAgYXN5bmMgYXJncyA9PiB0ZXh0UmVzdWx0KGF3YWl0IGNhbGxFeGVjKCcvdjEvaG9zdC1hY3Rpb25zL2V4ZWN1dGUnLCAnUE9TVCcsIGFyZ3MsIDEyMDAwMCkpCiAgKTsKCiAgbWNwLnJlZ2lzdGVyVG9vbCgKICAgICdob3N0X2FjdGlvbl9zdGF0dXMnLAogICAgewogICAgICB0aXRsZTogJ0ZpeGVkIEhvc3QgQWN0aW9uIFN0YXR1cycsCiAgICAgIGRlc2NyaXB0aW9uOiAnUmVhZCBwZXJzaXN0ZWQgc3RhdHVzIGFuZCB2ZXJpZmljYXRpb24gZXZpZGVuY2UgZm9yIGEgZml4ZWQgSG9zdCBBY3Rpb25zIHYxIHJlcXVlc3QuJywKICAgICAgaW5wdXRTY2hlbWE6IHsgcmVxdWVzdF9pZDogei5zdHJpbmcoKS51dWlkKCkgfSwKICAgICAgYW5ub3RhdGlvbnM6IFJPCiAgICB9LAogICAgYXN5bmMgYXJncyA9PiB0ZXh0UmVzdWx0KGF3YWl0IGNhbGxFeGVjKCcvdjEvaG9zdC1hY3Rpb25zL3N0YXR1cycsICdQT1NUJywgYXJncykpCiAgKTsK', 'base64').toString('utf8')
});

function shaText(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function read(file) { return fs.readFileSync(file, 'utf8'); }
function assertSha(label, file, expected) {
  const actual = shaText(read(file));
  if (actual !== expected) throw new Error(`sha_mismatch:${label}:${actual}`);
}
function replaceOnce(text, anchor, replacement, label) {
  const first = text.indexOf(anchor);
  if (first < 0) throw new Error(`anchor_missing:${label}`);
  if (text.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`anchor_not_unique:${label}`);
  return text.slice(0, first) + replacement + text.slice(first + anchor.length);
}
function writeAtomic(file, text, mode, uid, gid) {
  const tmp = `${file}.host-actions-v1-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.chmodSync(tmp, mode);
  fs.chownSync(tmp, uid, gid);
  fs.renameSync(tmp, file);
}
function backupFile(file, backupDir) {
  const dest = path.join(backupDir, file.replace(/^\//, '').replace(/\//g, '__'));
  fs.copyFileSync(file, dest, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(dest, 0o600);
  return dest;
}
function nodeCheck(file) {
  cp.execFileSync('/usr/local/bin/prhm-node', ['--check', file], { stdio: 'pipe', timeout: 15000 });
}
function systemctl(...args) {
  return cp.execFileSync('systemctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }).trim();
}
function curlUnix(socket, url) {
  return cp.execFileSync('curl', ['-fsS', '--max-time', '5', '--unix-socket', socket, url], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000
  }).trim();
}
function curlHttp(url) {
  return cp.execFileSync('curl', ['-fsS', '--max-time', '5', url], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 8000
  }).trim();
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function waitFor(fn, attempts = 30, delayMs = 500) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = fn();
      if (out) return out;
    } catch (e) { last = e; }
    sleep(delayMs);
  }
  throw last || new Error('health_timeout');
}

function patchPolicy(input) {
  const p = JSON.parse(input);
  if (p.schema_version !== 'prhm.approval-policy.v1') throw new Error('unexpected_policy_schema');
  p.version = '2026-08-12.1-host-actions-v1';
  p.operations = p.operations || {};
  p.operations['host_action.harden_agent_api_v1'] = { level: 4 };
  p.typed_scopes = Array.isArray(p.typed_scopes) ? p.typed_scopes : [];
  const matches = p.typed_scopes.filter(x =>
    x && x.tool === 'host_action_apply' && x.project === 'control_plane' &&
    x.environment === 'production' && x.action === 'harden_agent_api_v1' &&
    x.risk === 'critical' && x.operation === 'host_action.harden_agent_api_v1'
  );
  if (matches.length > 1) throw new Error('duplicate_host_action_scope');
  if (matches.length === 0) {
    p.typed_scopes.push({
      tool: 'host_action_apply',
      project: 'control_plane',
      environment: 'production',
      action: 'harden_agent_api_v1',
      risk: 'critical',
      operation: 'host_action.harden_agent_api_v1',
      principals: [{ principal_id: 'mohammad', roles: ['mcp-operator'] }]
    });
  }
  return JSON.stringify(p, null, 2) + '\n';
}

function patchBase(input) {
  if (input.includes('HOST_ACTIONS_V1_BASE_MARKER')) throw new Error('base_already_patched');
  let out = replaceOnce(
    input,
    "const OPERATION = 'selfmaint.patch_control_plane';",
    INJECT.base_constants,
    'base_constants'
  );
  const routeAnchor = "    if (req.method === 'POST' && req.url === '/v1/apply') {";
  out = replaceOnce(out, routeAnchor, INJECT.base_routes + routeAnchor, 'base_routes');
  return out;
}

function patchExec(input) {
  if (input.includes('HOST_ACTIONS_V1_EXEC_MARKER')) throw new Error('exec_already_patched');
  let out = replaceOnce(
    input,
    "const path = require('path');",
    "const path = require('path');\nconst cp = require('child_process');",
    'exec_import'
  );
  out = replaceOnce(
    out,
    "const SOCKET_GID = Number(process.env.SOCKET_GID || 0);",
    INJECT.exec_constants,
    'exec_constants'
  );
  out = replaceOnce(out, "async function handle(req, res) {", INJECT.exec_helpers + "async function handle(req, res) {", 'exec_helpers');
  out = replaceOnce(
    out,
    "      return json(res, 200, { ok: true, service: 'prhm-agent-selfmaint-exec', version: '1.0.0', base: sanitize(base) });",
    "      return json(res, 200, { ok: true, service: 'prhm-agent-selfmaint-exec', version: '1.1.0-host-actions-v1', host_actions: [HOST_ACTION_NAME], base: sanitize(base) });",
    'exec_health'
  );
  const routeAnchor = "    if (req.method === 'POST' && req.url === '/v1/request') {";
  out = replaceOnce(out, routeAnchor, INJECT.exec_routes + routeAnchor, 'exec_routes');
  out = replaceOnce(
    out,
    "ensureDir(JOB_DIR, 0o700);",
    "ensureDir(JOB_DIR, 0o700);\nensureDir(HOST_ACTION_REQUEST_DIR, 0o700);\nensureDir(HOST_ACTION_JOB_DIR, 0o700);",
    'exec_dirs'
  );
  return out;
}

function patchMcp(input) {
  if (input.includes('HOST_ACTIONS_V1_MCP_MARKER')) throw new Error('mcp_already_patched');
  const anchors = [
    "const Confirmation = z.literal('CONFIRM_LEVEL_4_CRITICAL');",
    "const Confirmation=z.literal('CONFIRM_LEVEL_4_CRITICAL');"
  ];
  const matches = anchors.filter(anchor => input.includes(anchor));
  if (matches.length !== 1) throw new Error(`mcp_confirmation_anchor_count:${matches.length}`);
  const anchor = matches[0];
  if (input.indexOf(anchor, input.indexOf(anchor) + anchor.length) >= 0) throw new Error('mcp_confirmation_anchor_not_unique');
  const replacement = anchor + "\nconst HOST_ACTIONS_V1_MCP_MARKER = true;\nconst HostAction = z.literal('harden_agent_api_v1');";
  let out = replaceOnce(input, anchor, replacement, 'mcp_constants');
  const closeAnchor = "\n}\n";
  const idx = out.lastIndexOf(closeAnchor);
  if (idx < 0) throw new Error('mcp_export_close_missing');
  out = out.slice(0, idx) + INJECT.mcp_tools + out.slice(idx);
  return out;
}

function restoreFile(file, backup) {
  const st = fs.statSync(file);
  const data = fs.readFileSync(backup);
  const tmp = `${file}.rollback-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data, { mode: st.mode & 0o777 });
  fs.chownSync(tmp, st.uid, st.gid);
  fs.renameSync(tmp, file);
}
function rollback(backups, oldDropin, oldDropinExists) {
  const errors = [];
  for (const [file, backup] of [...backups].reverse()) {
    try { restoreFile(file, backup); } catch (e) { errors.push(`${file}:${e.message}`); }
  }
  try {
    if (oldDropinExists) {
      fs.mkdirSync(PATHS.execDropinDir, { recursive: true, mode: 0o755 });
      fs.copyFileSync(oldDropin, PATHS.execDropin);
      fs.chmodSync(PATHS.execDropin, 0o644);
    } else {
      try { fs.unlinkSync(PATHS.execDropin); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  } catch (e) { errors.push(`dropin:${e.message}`); }
  try { systemctl('daemon-reload'); } catch (e) { errors.push(`daemon-reload:${e.message}`); }
  for (const service of SERVICES) {
    try { systemctl('restart', service); } catch (e) { errors.push(`${service}:${e.message}`); }
  }
  return errors;
}

function main() {
  const preflightOnly = process.argv.includes('--preflight-only');
  if (process.getuid && process.getuid() !== 0) throw new Error('root_required');
  if (fs.existsSync(PATHS.marker)) throw new Error('host_actions_v1_bootstrap_marker_exists');

  assertSha('policy', PATHS.policy, EXPECTED.policy);
  assertSha('base', PATHS.base, EXPECTED.base);
  assertSha('exec', PATHS.exec, EXPECTED.exec);
  assertSha('mcp', PATHS.mcp, EXPECTED.mcp);

  const originals = { policy: read(PATHS.policy), base: read(PATHS.base), exec: read(PATHS.exec), mcp: read(PATHS.mcp) };
  const patched = { policy: patchPolicy(originals.policy), base: patchBase(originals.base), exec: patchExec(originals.exec), mcp: patchMcp(originals.mcp) };
  JSON.parse(patched.policy);

  const preflightDir = `/tmp/prhm-host-actions-v1-preflight-${process.pid}`;
  fs.mkdirSync(preflightDir, { recursive: true, mode: 0o700 });
  const preflightFiles = {
    base: path.join(preflightDir, 'base-server.js'),
    exec: path.join(preflightDir, 'exec-server.js'),
    mcp: path.join(preflightDir, 'selfmaint.js')
  };
  fs.writeFileSync(preflightFiles.base, patched.base, { mode: 0o600 });
  fs.writeFileSync(preflightFiles.exec, patched.exec, { mode: 0o600 });
  fs.writeFileSync(preflightFiles.mcp, patched.mcp, { mode: 0o600 });
  nodeCheck(preflightFiles.base);
  nodeCheck(preflightFiles.exec);
  nodeCheck(preflightFiles.mcp);
  fs.rmSync(preflightDir, { recursive: true, force: true });

  if (preflightOnly) {
    console.log(JSON.stringify({
      ok: true,
      preflight_only: true,
      current_hashes: EXPECTED,
      candidate_hashes: {
        policy: shaText(patched.policy),
        base: shaText(patched.base),
        exec: shaText(patched.exec),
        mcp: shaText(patched.mcp)
      },
      host_action: 'harden_agent_api_v1',
      policy_version: '2026-08-12.1-host-actions-v1'
    }));
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const backupDir = `/var/backups/prhm-host-actions/bootstrap-${stamp}`;
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const backups = [];
  const fileMap = [['policy', PATHS.policy], ['base', PATHS.base], ['exec', PATHS.exec], ['mcp', PATHS.mcp]];
  for (const [, file] of fileMap) backups.push([file, backupFile(file, backupDir)]);

  fs.mkdirSync(PATHS.execDropinDir, { recursive: true, mode: 0o755 });
  fs.mkdirSync(PATHS.targetDropinDir, { recursive: true, mode: 0o755 });
  const oldDropinExists = fs.existsSync(PATHS.execDropin);
  const oldDropin = path.join(backupDir, 'executor-unit-dropin.bak');
  if (oldDropinExists) {
    fs.copyFileSync(PATHS.execDropin, oldDropin, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(oldDropin, 0o600);
  }

  try {
    for (const [key, file] of fileMap) {
      const st = fs.statSync(file);
      writeAtomic(file, patched[key], st.mode & 0o777, st.uid, st.gid);
    }

    fs.writeFileSync(PATHS.execDropin, `[Service]\nReadWritePaths=${PATHS.targetDropinDir}\n`, { mode: 0o644 });
    fs.chmodSync(PATHS.execDropin, 0o644);

    systemctl('daemon-reload');
    for (const service of SERVICES) systemctl('restart', service);
    for (const service of SERVICES) {
      const state = systemctl('is-active', service);
      if (state !== 'active') throw new Error(`service_not_active:${service}:${state}`);
    }

    const baseHealth = JSON.parse(waitFor(() => curlUnix('/run/prhm-agent-selfmaint/selfmaint.sock', 'http://localhost/health')));
    if (baseHealth.ok !== true) throw new Error('base_health_not_ok');

    const execHealth = JSON.parse(waitFor(() => curlUnix('/run/prhm-agent-selfmaint-exec/exec.sock', 'http://localhost/health')));
    if (execHealth.ok !== true || !Array.isArray(execHealth.host_actions) || !execHealth.host_actions.includes('harden_agent_api_v1')) {
      throw new Error('exec_host_actions_health_not_ok');
    }

    const mcpHealth = JSON.parse(waitFor(() => curlHttp('http://127.0.0.1:8123/health')));
    if (mcpHealth.ok !== true) throw new Error('mcp_health_not_ok');

    const result = {
      ok: true,
      schema_version: 'prhm.host-actions-bootstrap.v1',
      installed_at: new Date().toISOString(),
      backup_dir: backupDir,
      policy_version: '2026-08-12.1-host-actions-v1',
      host_action: 'harden_agent_api_v1',
      services: SERVICES,
      hashes: {
        policy: shaText(read(PATHS.policy)),
        base: shaText(read(PATHS.base)),
        exec: shaText(read(PATHS.exec)),
        mcp: shaText(read(PATHS.mcp))
      }
    };
    fs.mkdirSync(path.dirname(PATHS.marker), { recursive: true, mode: 0o700 });
    fs.writeFileSync(PATHS.marker, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(result));
  } catch (error) {
    const rollbackErrors = rollback(backups, oldDropin, oldDropinExists);
    if (rollbackErrors.length) throw new Error(`bootstrap_failed_and_rollback_incomplete:${error.message}:${rollbackErrors.join('|')}`);
    throw new Error(`bootstrap_failed_rolled_back:${error.message}`);
  }
}
main();
