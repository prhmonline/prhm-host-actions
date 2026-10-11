'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),cp=require('node:child_process'),path=require('node:path');
const base=__dirname;
for(const file of ['node1-central-sftp-provision-v1.sh','central-node1-sftp-client-provision-v1.sh']){
 test('provision shell parses and refuses missing explicit --apply: '+file,()=>{
  const full=path.join(base,file);
  const b=cp.spawnSync('/usr/bin/bash',['-n',full],{encoding:'utf8'});
  assert.equal(b.status,0,b.stderr);
  const r=cp.spawnSync('/usr/bin/bash',[full],{encoding:'utf8',timeout:4000});
  assert.notEqual(r.status,0,'never execute without --apply');
 });
}
test('remote provisioner forces nonroot chroot and rollback on SSHD failure',()=>{
 const s=fs.readFileSync(path.join(base,'node1-central-sftp-provision-v1.sh'),'utf8');
 for(const part of ['Match User prhmbackup','ChrootDirectory /srv/prhm-sftp','ForceCommand internal-sftp -d /repo','PasswordAuthentication no','KbdInteractiveAuthentication no','PermitTTY no','AllowTcpForwarding no','AllowAgentForwarding no','cp -p "$SSHD" "$BACKUP"','/usr/sbin/sshd -t','systemctl reload sshd','trap rollback EXIT','userdel prhmbackup'])assert.ok(s.includes(part),part);
 assert.ok(!s.includes('PermitRootLogin no'));
});
test('central provisioner pins prior trusted Node1 host key, forbids passwords',()=>{
 const s=fs.readFileSync(path.join(base,'central-node1-sftp-client-provision-v1.sh'),'utf8');
 for(const part of ['ssh-keygen\',\'-F','HOST_KEY_PIN_MISMATCH','GlobalKnownHostsFile /dev/null','StrictHostKeyChecking yes','BatchMode yes','PreferredAuthentications publickey','PasswordAuthentication no','openssl rand -hex 48','id_ed25519','chmod 0600'])assert.ok(s.includes(part),part);
 assert.ok(!s.includes('StrictHostKeyChecking no'));
});
