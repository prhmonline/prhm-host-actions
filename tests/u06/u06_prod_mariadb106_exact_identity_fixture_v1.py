#!/usr/bin/env python3
"""Networkless MariaDB 10.6 fixed U06 backup-account parity. Only --isolated-fixture."""
import hashlib,json,re,secrets,subprocess,sys,tempfile,time,uuid
from pathlib import Path

IMAGE='mariadb@sha256:114d40be36852d0a019afd8458f7e1cc63fd300403b115b1f32e31130d5f671b'
PROFILE='/etc/deploy-control/projects/honartik_back.production.json'
PROFILE_SHA='79783874cb5170eec3dedcc536f713c4567c585e118f881c1035862a7bba8698'
ACCOUNT='honartik_universal_backup'
HOST='127.0.0.1'
SEED="""CREATE DATABASE honartik_db; USE honartik_db;
CREATE TABLE finance_transactions(id INT PRIMARY KEY,amount BIGINT NOT NULL);
CREATE TABLE finance_wallet(id INT PRIMARY KEY,amount BIGINT NOT NULL);
CREATE TABLE reserve(id INT PRIMARY KEY,finance_id INT NOT NULL,
FOREIGN KEY(finance_id) REFERENCES finance_transactions(id));
INSERT INTO finance_transactions VALUES(1,100),(2,200);
INSERT INTO finance_wallet VALUES(1,300);
INSERT INTO reserve VALUES(1,1),(2,2);"""

def run(args,stdin=None,timeout=120):
    p=subprocess.run(args,input=stdin,stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE,timeout=timeout)
    if p.returncode: raise RuntimeError('isolated_command_failed')
    return p.stdout
def query(name,sql):
    return run(['docker','exec','-i',name,'mariadb','-uroot','-N','-B'],
               sql.encode(),timeout=45).decode().strip()
def wait_server(name):
    for _ in range(90):
        try:
            proc=run(['docker','exec',name,'cat','/proc/1/comm'],timeout=5).decode().strip()
            if proc in ('mariadbd','mysqld'):
                run(['docker','exec',name,'mariadb-admin','ping','-uroot'],timeout=5)
                return
        except (RuntimeError,subprocess.TimeoutExpired): pass
        time.sleep(1)
    raise RuntimeError('sandbox_mariadb_not_ready')
def exact_grants(name):
    grants=query(name,"SHOW GRANTS FOR 'honartik_universal_backup'@'127.0.0.1';").splitlines()
    if len(grants)!=2:raise RuntimeError('unexpected_grants_count')
    got={}
    for line in grants:
        m=re.match(r'^GRANT ([A-Z ,]+) ON (.*?) TO ',line,re.I)
        if not m or 'WITH GRANT OPTION' in line:raise RuntimeError('untrusted_grant')
        got[m.group(2)]=tuple(sorted(x.strip().upper() for x in m.group(1).split(',')))
    schema=got.get('honartik_db.*') or got.get(chr(96)+'honartik_db'+chr(96)+'.*')
    if got.get('*.*')!=('USAGE',) or schema!=('EVENT','SELECT','SHOW VIEW','TRIGGER'):
        raise RuntimeError('grant_scope_drift')
def container(name):
    run(['docker','run','-d','--name',name,'--network=none','--memory=768m',
         '--cpus=1','--pids-limit=128','--security-opt=no-new-privileges',
         '--label','prhm.u06.sandbox=1','-e','MYSQL_ALLOW_EMPTY_PASSWORD=yes',
         IMAGE],timeout=100)
    wait_server(name)
def main():
    if sys.argv[1:]!=['--isolated-fixture']:
        raise SystemExit('ONLY --isolated-fixture; NO LIVE APPLY')
    before=hashlib.sha256(Path(PROFILE).read_bytes()).hexdigest()
    if before!=PROFILE_SHA:raise SystemExit('production_profile_changed')
    suffix=uuid.uuid4().hex[:8]
    src='u06-backupid-'+suffix;dst='u06-restoreid-'+suffix
    live=[];created=False;result={}
    with tempfile.TemporaryDirectory(dir='/var/tmp',prefix='u06-db-identity-fixture-') as td:
        base=Path(td);base.chmod(0o700)
        cred=base/'client.cnf'
        try:
            container(src);live.append(src)
            query(src,SEED)
            password=secrets.token_urlsafe(48)
            assert re.fullmatch('[A-Za-z0-9_-]{64}',password)
            query(src,"CREATE USER '"+ACCOUNT+"'@'"+HOST+"' IDENTIFIED BY '"+password+"';")
            created=True
            query(src,"GRANT SELECT, SHOW VIEW, TRIGGER, EVENT ON honartik_db.* TO '"+
                  ACCOUNT+"'@'"+HOST+"';")
            exact_grants(src)
            cred.write_text('[client]\nuser='+ACCOUNT+'\npassword='+password+
                            '\nhost=127.0.0.1\nport=3306\nprotocol=tcp\n')
            cred.chmod(0o600)
            run(['docker','cp',str(cred),src+':/tmp/u06-test.cnf'])
            del password
            common=['docker','exec',src]
            assert run(common+['mariadb','--defaults-extra-file=/tmp/u06-test.cnf',
                   '--host=127.0.0.1','--protocol=tcp','-N','-B','-e','SELECT 1']).strip()==b'1'
            sql=run(common+['mariadb-dump','--defaults-extra-file=/tmp/u06-test.cnf',
                  '--single-transaction','--routines','--triggers','--events','--hex-blob',
                  '--host=127.0.0.1','--port=3306','honartik_db'],timeout=90)
            assert len(sql)>1000
            container(dst);live.append(dst)
            query(dst,'CREATE DATABASE honartik_db;')
            run(['docker','exec','-i',dst,'mariadb','-uroot','honartik_db'],sql,timeout=70)
            totals=query(dst,"SELECT COUNT(*),SUM(amount) FROM honartik_db.finance_transactions;"+
                "SELECT COUNT(*),SUM(amount) FROM honartik_db.finance_wallet;"+
                "SELECT COUNT(*) FROM honartik_db.reserve;"+
                "SELECT COUNT(*) FROM information_schema.referential_constraints "+
                "WHERE constraint_schema='honartik_db';")
            assert totals.splitlines()==['2\t300','1\t300','2','1']
            assert b'OK' in run(['docker','exec',dst,'mariadb-check','-uroot',
                                 '--check','honartik_db'],timeout=80)
            result=dict(schema='prhm.u06.mariadb106.backup-identity-fixture.v1',
                        result='PASS',mariadb_immutable_image=IMAGE,
                        exact_account=ACCOUNT,exact_account_host=HOST,
                        privilege_scope_verified=True,tcp_login_verified=True,
                        independent_restore_verified=True,finance_fk_check=True,
                        mysqlcheck_pass=True,backup_sha256=hashlib.sha256(sql).hexdigest(),
                        production_database_mutated=False,
                        production_credentials_read=False)
        finally:
            try:
                if created:
                    query(src,"DROP USER '"+ACCOUNT+"'@'"+HOST+"';")
                    assert query(src,"SELECT COUNT(*) FROM mysql.user WHERE User='"+
                            ACCOUNT+"' AND Host='"+HOST+"';")=='0'
                    result['fixture_account_removed']=True
            finally:
                if cred.exists():cred.unlink()
                result['fixture_credential_removed']=not cred.exists()
                for name in reversed(live):
                    run(['docker','rm','-fv',name],timeout=55)
                result['fixture_containers_removed']=True
        assert hashlib.sha256(Path(PROFILE).read_bytes()).hexdigest()==before
        result['production_profile_unchanged']=True
        print(json.dumps(result,sort_keys=True))

if __name__=='__main__':main()
