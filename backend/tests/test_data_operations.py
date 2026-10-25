"""Mocked operation/token/concurrency guards; never execute database writes."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import hmac
import json
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import jwt
import pytest
from sqlalchemy.dialects import postgresql

USER=UUID('b1c786c4-efca-480b-b964-c872e5700587')
OWNER=UUID('d9701d64-cb64-4e50-bce8-f46075af997a')
SID=UUID('09ea039c-d243-4e1b-9caa-b879910b380d')
OTHER=UUID('774106ad-138c-487d-8d8f-48b0d5970668')
SECRET='synthetic-offline-signing-key-which-never-authenticates-real-requests'


@pytest.fixture(autouse=True)
def no_live_io(monkeypatch):
    import psycopg
    import subprocess
    forbidden=MagicMock(side_effect=AssertionError('Real database/process access forbidden in operation tests'))
    monkeypatch.setattr(psycopg,'connect',forbidden)
    monkeypatch.setattr(subprocess,'run',forbidden)
    monkeypatch.setattr(subprocess,'Popen',forbidden)


def compile_sql(statement):
    return str(statement.compile(dialect=postgresql.dialect()))


def test_common_financial_create_requires_owner_lock_before_any_mutation():
    from app.services import finance
    from app.models import Transaction
    events=[];session=MagicMock()
    def scalar(statement):
        events.append(('read',compile_sql(statement)))
        return OWNER
    session.scalar.side_effect=scalar
    session.execute.side_effect=lambda statement:events.append(('execute',compile_sql(statement)))
    session.add.side_effect=lambda record:events.append(('add',record))
    finance.create_record(session,Transaction,OWNER,{'title':'Synthetic','amount_usd':Decimal('1.00000000'),'type':'income','category':'Synthetic','transaction_date':datetime(2026,10,25).date()})
    assert events[0][0]=='read'
    assert 'owners' in events[0][1] and 'FOR UPDATE' in events[0][1]
    assert next(index for index,event in enumerate(events) if event[0]=='add')>0
    assert not any(event[0]=='execute' and event[1].startswith('INSERT INTO owners') for event in events)


def test_missing_owner_never_bootstraps_or_mutates_financial_rows():
    from app.services import finance
    from app.models import Transaction
    session=MagicMock();session.scalar.return_value=None
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as caught:
        finance.create_record(session,Transaction,OWNER,{'title':'Synthetic','amount_usd':Decimal('1.00000000'),'type':'income','category':'Synthetic','transaction_date':datetime(2026,10,25).date()})
    assert caught.value.status_code==401
    session.add.assert_not_called();session.flush.assert_not_called()
    assert not any(str(call.args[0]).startswith('INSERT') for call in session.execute.call_args_list)

@pytest.fixture
def settings():
    from app.config import Settings
    return Settings(_env_file=None,DATABASE_URL='postgresql+psycopg://synthetic:unused@127.0.0.1:65432/unused',AUTH_JWT_SECRET=SECRET)


@pytest.fixture
def user():
    from app.auth import AuthenticatedUser
    return AuthenticatedUser(id=USER,email='synthetic@example.test',owner_id=OWNER,session_id=SID)


def token_claims(now=None):
    now=now or datetime.now(timezone.utc).replace(microsecond=0)
    stamp=int(now.timestamp())
    return {'iss':'finance-dashboard','aud':'finance-dashboard-data-preview','type':'data_preview','sub':str(USER),'sid':str(SID),'owner_id':str(OWNER),'kind':'import_replace','document_sha256':'d'*64,'state_sha256':'a'*64,'iat':stamp,'nbf':stamp,'exp':stamp+600,'jti':str(uuid4())}


def signed_token(settings,claims,algorithm='HS256'):
    from app.data_authorization import derive_preview_key
    return jwt.encode(claims,derive_preview_key(settings),algorithm=algorithm)


def test_preview_key_is_separate_domain_derived_not_access_key(settings):
    from app.data_authorization import derive_preview_key
    expected=hmac.new(SECRET.encode(),b'finance-dashboard:data-preview:v1',hashlib.sha256).digest()
    assert derive_preview_key(settings)==expected
    assert derive_preview_key(settings)!=SECRET.encode()


def test_issued_preview_token_has_exact_session_purpose_and_ten_minute_lifetime(settings,user):
    from app.data_authorization import issue_preview_token,validate_preview_token,derive_preview_key
    now=datetime.now(timezone.utc).replace(microsecond=0)
    encoded,expires=issue_preview_token(settings,user,'import_replace','d'*64,'a'*64,now=now)
    claims=jwt.decode(encoded,derive_preview_key(settings),algorithms=['HS256'],audience='finance-dashboard-data-preview',issuer='finance-dashboard')
    assert claims['sub']==str(USER) and claims['sid']==str(SID) and claims['owner_id']==str(OWNER)
    assert claims['kind']=='import_replace' and claims['type']=='data_preview'
    assert claims['iat']==claims['nbf']==int(now.timestamp())
    assert claims['exp']==claims['iat']+600 and expires==now+timedelta(seconds=600)
    assert UUID(claims['jti'])
    result=validate_preview_token(settings,encoded,user,'import_replace','d'*64,state_sha256='a'*64,now=now)
    assert result['jti']==claims['jti']


@pytest.mark.parametrize('field,value',[('iss','other'),('aud','finance-dashboard-web'),('type','access'),('sub',str(OTHER)),('sid',str(OTHER)),('owner_id',str(OTHER)),('kind','reset'),('document_sha256','b'*64),('state_sha256','b'*64),('iat',True),('nbf',True),('exp',True),('exp',1),('jti','not-a-uuid'),('document_sha256','not-a-hash')])
def test_preview_token_rejects_forged_or_wrong_scope_claims(settings,user,field,value):
    from app.data_authorization import validate_preview_token
    from app.data_operation_errors import DataOperationError
    claims=token_claims();claims[field]=value
    with pytest.raises(DataOperationError):validate_preview_token(settings,signed_token(settings,claims),user,'import_replace','d'*64,state_sha256='a'*64)


@pytest.mark.parametrize('field',['sub','sid','owner_id','kind','document_sha256','state_sha256','jti','iat','nbf','exp','type','aud','iss'])
def test_preview_token_requires_every_security_claim(settings,user,field):
    from app.data_authorization import validate_preview_token
    from app.data_operation_errors import DataOperationError
    claims=token_claims();del claims[field]
    with pytest.raises(DataOperationError):validate_preview_token(settings,signed_token(settings,claims),user,'import_replace','d'*64)


@pytest.mark.parametrize('lifetime',[599,601])
def test_preview_token_rejects_other_than_exact_ttl(settings,user,lifetime):
    from app.data_authorization import validate_preview_token
    from app.data_operation_errors import DataOperationError
    claims=token_claims();claims['exp']=claims['iat']+lifetime
    with pytest.raises(DataOperationError):validate_preview_token(settings,signed_token(settings,claims),user,'import_replace','d'*64)


def test_preview_expiry_has_no_leeway_and_sid_none_cannot_issue(settings,user):
    from app.data_authorization import validate_preview_token,issue_preview_token
    from app.data_operation_errors import DataOperationError
    now=datetime.now(timezone.utc).replace(microsecond=0);claims=token_claims(now)
    with pytest.raises(DataOperationError) as caught:validate_preview_token(settings,signed_token(settings,claims),user,'import_replace','d'*64,now=now+timedelta(seconds=600))
    assert caught.value.code=='PREVIEW_EXPIRED'
    no_sid=SimpleNamespace(id=USER,owner_id=OWNER,session_id=None)
    with pytest.raises(DataOperationError):issue_preview_token(settings,no_sid,'reset',hashlib.sha256(b'').hexdigest(),'a'*64)


def test_preview_rejects_other_algorithm_and_access_key_signing(settings,user):
    from app.data_authorization import validate_preview_token
    from app.data_operation_errors import DataOperationError
    claims=token_claims()
    for encoded in [jwt.encode(claims,b'x'*64,algorithm='HS384'),jwt.encode(claims,SECRET,algorithm='HS256')]:
        with pytest.raises(DataOperationError):validate_preview_token(settings,encoded,user,'import_replace','d'*64)

class Rows:
    def __init__(self,values=(),scalar_values=None):self.values=list(values);self.scalar_values=scalar_values;self.closed=False
    def __iter__(self):return iter(self.values)
    def close(self):self.closed=True
    def scalars(self):return self
    def all(self):return self.scalar_values if self.scalar_values is not None else self.values


class StateConnection:
    def __init__(self,records=None,revision='0004_data_operations'):
        self.records=records or {};self.statements=[];self.results=[];self.revision=revision
    def execute(self,statement):
        from sqlalchemy.sql.elements import TextClause
        self.statements.append(statement)
        if isinstance(statement,TextClause):return Rows(scalar_values=[self.revision])
        table=statement.get_final_froms()[0]
        if table.name=='data_operation_receipts':result=Rows()
        else:
            owners=[value for value in statement.compile().params.values() if isinstance(value,UUID)]
            values=sorted([row for row in self.records.get(table.name,[]) if row['owner_id'] in owners],key=lambda row:row['id'])
            result=Rows([tuple(row.get(column.key) for column in statement.selected_columns) for row in values])
        self.results.append(result);return result


def state_row(number=1,**changes):
    return {'id':UUID(int=number),'owner_id':OWNER,'title':'Synthetic','amount_usd':Decimal('1.00000000'),'type':'income','category':'Synthetic','transaction_date':datetime(2026,10,25).date(),'created_at':datetime(2026,10,25,tzinfo=timezone.utc),'updated_at':datetime(2026,10,25,tzinfo=timezone.utc)}|changes


@pytest.mark.parametrize('field,value',[('id',OTHER),('title','Changed'),('amount_usd',Decimal('1.00000001')),('category','Changed'),('transaction_date',datetime(2026,10,26).date()),('updated_at',datetime(2026,10,25,0,0,1,tzinfo=timezone.utc))])
def test_full_state_hash_detects_changes_even_when_counts_unchanged(field,value):
    from app.services.data_state import read_owner_state
    original=read_owner_state(StateConnection({'transactions':[state_row()]}),OWNER)
    changed=read_owner_state(StateConnection({'transactions':[state_row(**{field:value})]}),OWNER)
    assert original.counts==changed.counts and original.sha256!=changed.sha256


def test_state_hash_scopes_all_columns_and_rows_including_absence_and_owner_domain():
    from app.services.data_state import read_owner_state
    records={'transactions':[state_row(number=n+1) for n in range(10001)]+[state_row(number=10002,owner_id=OTHER,title='Foreign private')]}
    conn=StateConnection(records);state=read_owner_state(conn,OWNER)
    assert state.counts.transactions==10001
    assert state.sha256!=read_owner_state(StateConnection(),OWNER).sha256
    assert read_owner_state(StateConnection(),OWNER).sha256!=read_owner_state(StateConnection(),OTHER).sha256
    for statement in conn.statements:
        assert statement._limit_clause is None and statement._offset_clause is None
        table=statement.get_final_froms()[0]
        assert {column.name for column in statement.selected_columns}==set(table.columns.keys())
        assert '.owner_id = ' in compile_sql(statement) and 'ORDER BY' in compile_sql(statement) and '.id ASC' in compile_sql(statement)
        assert statement.get_execution_options()['yield_per']==100
    assert all(result.closed for result in conn.results)


def test_state_hash_canonical_decimal_scale_and_utc_instants():
    from app.services.data_state import read_owner_state
    left=state_row(amount_usd=Decimal('1.0'))
    right=state_row(amount_usd=Decimal('1.00000000'),created_at=datetime(2026,10,25,5,tzinfo=timezone(timedelta(hours=5))))
    assert read_owner_state(StateConnection({'transactions':[left]}),OWNER).sha256==read_owner_state(StateConnection({'transactions':[right]}),OWNER).sha256


def test_missing_receipt_migration_fails_schema_gate_without_financial_reads():
    from app.services.data_state import require_data_schema
    from app.data_operation_errors import DataOperationError
    conn=StateConnection(revision='0003_auth')
    with pytest.raises(DataOperationError) as caught:require_data_schema(conn)
    assert caught.value.code=='DATA_OPERATIONS_UNAVAILABLE'
    assert len(conn.statements)==1


def test_preview_state_sets_readonly_repeatable_read_before_schema_or_data_and_rolls_back():
    from app.services.data_state import read_preview_state
    conn=MagicMock()
    conn.execute.side_effect=StateConnection().execute
    tx=MagicMock();conn.begin.return_value=tx
    engine=MagicMock();engine.connect.return_value.__enter__.return_value=conn
    read_preview_state(engine,OWNER)
    assert str(conn.execute.call_args_list[0].args[0])=='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
    tx.rollback.assert_called_once_with();tx.commit.assert_not_called()

class AtomicSession:
    """In-memory transaction double; applies actual compiled DELETE owner predicates."""
    def __init__(self):
        self.records={'transactions':[state_row(),state_row(number=2,owner_id=OTHER,title='Foreign legacy')], 'subscriptions':[], 'budget_profiles':[], 'preferences':[]}
        self.receipts=[];self.events=[];self.active=True;self.schema_ready=True;self.failure_flush=None;self.flushes=0;self.commit_error=False;self.after_dml_revoke=False
        self.tx=MagicMock();self.tx.commit.side_effect=self.commit;self.tx.rollback.side_effect=self.rollback
        self.snapshot=None
    def begin(self):
        self.events.append('begin');self.snapshot=deepcopy((self.records,self.receipts));return self.tx
    def commit(self):
        self.events.append('commit')
        if self.commit_error:raise OSError('Synthetic commit acknowledgement lost')
    def rollback(self):
        self.events.append('rollback');self.records,self.receipts=deepcopy(self.snapshot)
    def connection(self):return self
    def execute(self,statement):
        from sqlalchemy.sql.dml import Delete
        sql=compile_sql(statement);self.events.append(sql)
        if isinstance(statement,Delete):
            name=statement.table.name
            assert name in self.records,'Never delete owner/auth/legacy/receipt tables'
            assert OWNER in statement.compile().params.values() and '.owner_id = ' in sql
            self.records[name]=[row for row in self.records[name] if row['owner_id']!=OWNER]
        return Rows()
    def scalar(self,statement):
        from app.models import DataOperationReceipt
        sql=compile_sql(statement);self.events.append(sql)
        params=statement.compile().params
        if 'FROM owners' in sql:return OWNER
        if 'JOIN auth_sessions' in sql:
            if not self.active or self.after_dml_revoke and self.flushes:return None
            return SimpleNamespace(password_hash='synthetic-hash')
        if 'FROM data_operation_receipts' in sql:
            selected=list(statement.selected_columns)
            if len(selected)==1 and selected[0].name=='idempotency_key':
                return next((row.idempotency_key for row in self.receipts if row.owner_id==OWNER and row.preview_id in params.values()),None)
            return next((row for row in self.receipts if row.owner_id==OWNER and row.idempotency_key in params.values()),None)
        raise AssertionError('Unexpected read '+sql)
    def add(self,record):
        from app.models import DataOperationReceipt
        self.events.append('add:'+record.__tablename__)
        if isinstance(record,DataOperationReceipt):self.receipts.append(record);return
        row={column.name:getattr(record,column.name,None) for column in record.__table__.columns}
        for name in ('created_at','updated_at'):
            if row.get(name) is None:row[name]=datetime.now(timezone.utc)
        self.records[record.__tablename__].append(row)
    def flush(self):
        self.flushes+=1;self.events.append('flush')
        if self.failure_flush==self.flushes:raise RuntimeError('Synthetic storage fault')


@pytest.fixture
def operation_run(settings,user,monkeypatch):
    import app.services.data_operations as service
    from app.services.data_state import read_owner_state
    from app.data_authorization import issue_preview_token
    session=AtomicSession()
    def state(connection,owner):
        connection.events.append('state')
        return read_owner_state(StateConnection(connection.records),owner)
    def schema(connection):
        from app.data_operation_errors import unavailable
        connection.events.append('schema')
        if not connection.schema_ready:raise unavailable()
    monkeypatch.setattr(service,'read_owner_state',state)
    monkeypatch.setattr(service,'require_data_schema',schema)
    password=MagicMock(side_effect=lambda stored,value:value=='synthetic-password')
    monkeypatch.setattr(service,'password_matches',password)
    before=read_owner_state(StateConnection(session.records),OWNER)
    token,_=issue_preview_token(settings,user,'reset',hashlib.sha256(b'').hexdigest(),before.sha256)
    body={'preview_token':token,'password':'synthetic-password','confirmation':'RESET MY FINANCIAL DATA'}
    return SimpleNamespace(service=service,session=session,body=body,key=uuid4(),password=password,before=before)


def reset(run,settings,user,**changes):
    return run.service.reset_data(run.session,user,settings,json.dumps(run.body|changes).encode(),run.key)


def test_atomic_reset_locks_owner_then_real_session_before_receipts_state_and_deletes(operation_run,settings,user):
    run=operation_run;result=reset(run,settings,user)
    events=run.session.events
    owner=next(i for i,event in enumerate(events) if 'FROM owners' in event)
    auth=next(i for i,event in enumerate(events) if 'JOIN auth_sessions' in event)
    receipt=next(i for i,event in enumerate(events) if 'FROM data_operation_receipts' in event)
    state=events.index('state');dml=next(i for i,event in enumerate(events) if event.startswith('DELETE'))
    assert owner<auth<receipt<state<dml
    assert 'READ COMMITTED' in events[1]
    assert 'FOR UPDATE' in events[owner] and 'FOR SHARE' in events[auth]
    assert result.removed.transactions==1 and result.created.transactions==0
    assert len(run.session.records['transactions'])==1 and run.session.records['transactions'][0]['owner_id']==OTHER
    assert len(run.session.receipts)==1
    row=run.session.receipts[0]
    assert row.owner_id==OWNER and row.idempotency_key==run.key
    assert not any(marker in json.dumps(row.result_json) for marker in ('synthetic-password',run.body['preview_token'],'Foreign legacy'))
    assert 'commit'==events[-1]
    run.session.tx.commit.assert_called_once_with();run.session.tx.rollback.assert_not_called()


@pytest.mark.parametrize('phase',['first_flush','receipt_flush','schema','session_before','session_after','password','confirmation','stale_state','expired_before_commit'])
def test_all_precommit_failures_rollback_financial_data_and_receipt_atomically(operation_run,settings,user,monkeypatch,phase):
    from app.data_operation_errors import DataOperationError
    run=operation_run;before=deepcopy(run.session.records)
    changes={}
    if phase=='first_flush':run.session.failure_flush=1
    if phase=='receipt_flush':run.session.failure_flush=2
    if phase=='schema':run.session.schema_ready=False
    if phase=='session_before':run.session.active=False
    if phase=='session_after':run.session.after_dml_revoke=True
    if phase=='password':changes['password']='incorrect-password'
    if phase=='confirmation':changes['confirmation']='reset'
    if phase=='stale_state':run.session.records['transactions'][0]['title']='Changed after preview';before=deepcopy(run.session.records)
    if phase=='expired_before_commit':
        original=run.service.validate_preview_token;calls=0
        def validate(*args,**kwargs):
            nonlocal calls
            calls+=1
            if calls==3:raise DataOperationError(409,'PREVIEW_EXPIRED','Expired')
            return original(*args,**kwargs)
        monkeypatch.setattr(run.service,'validate_preview_token',validate)
    with pytest.raises((DataOperationError,RuntimeError)) as caught:reset(run,settings,user,**changes)
    assert run.session.records==before and not run.session.receipts
    run.session.tx.rollback.assert_called_once_with();run.session.tx.commit.assert_not_called()
    if phase=='session_after':assert caught.value.status_code!=401
    if phase=='schema':assert not any(event.startswith('DELETE') for event in run.session.events)


def test_commit_acknowledgement_loss_is_unknown_without_rollback_or_automatic_second_attempt(operation_run,settings,user):
    from app.data_operation_errors import DataOperationError
    run=operation_run;run.session.commit_error=True
    with pytest.raises(DataOperationError) as caught:reset(run,settings,user)
    assert caught.value.status_code==503 and caught.value.code=='OPERATION_OUTCOME_UNKNOWN'
    run.session.tx.commit.assert_called_once_with();run.session.tx.rollback.assert_not_called()
    assert len(run.session.receipts)==1


def test_completed_receipt_replay_skips_expired_token_password_state_and_dml(operation_run,settings,user,monkeypatch):
    run=operation_run;first=reset(run,settings,user)
    writes=sum(event.startswith('DELETE') for event in run.session.events)
    run.password.reset_mock()
    monkeypatch.setattr(run.service,'validate_preview_token',MagicMock(side_effect=AssertionError('Receipt replay must bypass expired preview')))
    monkeypatch.setattr(run.service,'read_owner_state',MagicMock(side_effect=AssertionError('Receipt replay must not compare old state')))
    replay=reset(run,settings,user,preview_token='expired-or-invalid-token',password='incorrect-password',confirmation='wrong')
    assert replay==first
    assert sum(event.startswith('DELETE') for event in run.session.events)==writes
    run.password.assert_not_called()
    assert run.session.tx.commit.call_count==1 and run.session.tx.rollback.call_count==1


def test_receipt_replay_still_requires_current_session_binding(operation_run,settings,user):
    from app.data_operation_errors import DataOperationError
    run=operation_run;reset(run,settings,user);run.session.active=False
    with pytest.raises(DataOperationError):reset(run,settings,user)
    assert run.session.tx.commit.call_count==1


def test_semantic_request_hash_covers_only_business_kind_and_document_identity():
    from app.services.data_operations import semantic_request_sha256
    value={'kind':'import_replace','mode':'replace','source_format':'v1','document_sha256':'d'*64}
    expected=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assert semantic_request_sha256('import_replace','d'*64)==expected
    assert semantic_request_sha256('import_replace','b'*64)!=expected
    assert semantic_request_sha256('reset')!=expected


def import_body(run,settings,user,document=None,preview_token=None):
    from app.data_authorization import issue_preview_token
    from app.services.import_preview import parse_document
    from app.services.data_state import read_owner_state
    if document is None:
        document={'format':'finance-dashboard','schema_version':1,'exported_at':'2026-10-25T00:00:00Z','base_currency':'USD','data':{'transactions':[{'title':'Duplicate legitimate','amount_usd':'999999999999.99999999','type':'income','category':'Synthetic','transaction_date':'2026-10-25'}]*2,'subscriptions':[{'service_name':'Synthetic','amount_usd':'0.00000001','next_payment_date':'2026-11-01','icon':'credit-card','status':'active'}],'budget':{'monthly_income_usd':'0.00000000','needs_spent_usd':'0.00000000','wants_spent_usd':'0.00000000','savings_usd':'0.00000000'},'preferences':{'display_currency':'EUR'}}}
    inner=json.dumps(document,ensure_ascii=False)
    parsed=parse_document(inner)
    state=read_owner_state(StateConnection(run.session.records),OWNER)
    token,_=issue_preview_token(settings,user,'import_replace',parsed.document_sha256,state.sha256)
    return json.dumps({'mode':'replace','source_format':'v1','document':inner,'preview_token':preview_token or token,'password':'synthetic-password','confirmation':'REPLACE MY FINANCIAL DATA'}).encode()


def test_import_replaces_only_owner_data_with_fresh_ids_exact_money_and_no_value_dedup(operation_run,settings,user):
    run=operation_run;before=deepcopy(run.session.records)
    result=run.service.apply_import(run.session,user,settings,import_body(run,settings,user),run.key)
    own=[row for row in run.session.records['transactions'] if row['owner_id']==OWNER]
    foreign=[row for row in run.session.records['transactions'] if row['owner_id']==OTHER]
    assert len(own)==2 and len({row['id'] for row in own})==2
    assert all(row['id']!=UUID(int=1) and type(row['id']) is UUID for row in own)
    assert all(row['amount_usd']==Decimal('999999999999.99999999') for row in own)
    assert foreign==[row for row in before['transactions'] if row['owner_id']==OTHER]
    assert result.created.model_dump()=={'transactions':2,'subscriptions':1,'budget_profiles':1,'preferences':1}
    assert result.removed.transactions==1
    assert run.session.records['preferences'][0]['display_currency']=='EUR'
    assert len(run.session.receipts)==1


def test_last_receipt_unique_conflict_rolls_back_entire_replacement(operation_run,settings,user):
    from sqlalchemy.exc import IntegrityError
    run=operation_run;before=deepcopy(run.session.records)
    original=run.session.flush
    def flush():
        if run.session.flushes==1:
            raise IntegrityError(None,None,SimpleNamespace(sqlstate='23505'))
        original()
    run.session.flush=flush
    with pytest.raises(IntegrityError):run.service.apply_import(run.session,user,settings,import_body(run,settings,user),run.key)
    assert run.session.records==before and not run.session.receipts
    run.session.tx.commit.assert_not_called();run.session.tx.rollback.assert_called_once_with()


def test_used_preview_cannot_be_applied_under_another_key_even_for_empty_reset(operation_run,settings,user):
    from app.data_operation_errors import DataOperationError
    run=operation_run;reset(run,settings,user);run.key=uuid4()
    with pytest.raises(DataOperationError) as caught:reset(run,settings,user)
    assert caught.value.code=='PREVIEW_USED' and len(run.session.receipts)==1
    assert run.session.tx.commit.call_count==1


def test_same_key_different_business_kind_conflicts_before_preview_or_password(operation_run,settings,user):
    from app.data_operation_errors import DataOperationError
    run=operation_run;reset(run,settings,user);run.password.reset_mock()
    with pytest.raises(DataOperationError) as caught:run.service.apply_import(run.session,user,settings,import_body(run,settings,user,preview_token='invalid-old-token'),run.key)
    assert caught.value.code=='IDEMPOTENCY_CONFLICT';run.password.assert_not_called()
    assert run.session.tx.commit.call_count==1


def test_bulk_import_reuses_strict_duplicate_key_parser_before_opening_transaction(operation_run,settings,user):
    from app.data_operation_errors import DataOperationError
    run=operation_run
    raw=b'{"preview_token":"a","preview_token":"b"}'
    with pytest.raises(DataOperationError) as caught:run.service.apply_import(run.session,user,settings,raw,run.key)
    assert caught.value.status_code==422 and run.session.events==[]


def test_actual_reset_preview_builds_real_response_with_reset_warning_and_bound_token(settings,user,monkeypatch):
    import app.services.data_operations as service
    from app.services.data_state import DataState
    from app.import_preview_schemas import PreviewCounts
    from app.data_authorization import validate_preview_token,EMPTY_DOCUMENT_SHA256
    state=DataState(PreviewCounts(transactions=2,subscriptions=1,budget_profiles=1,preferences=1),'a'*64)
    read=MagicMock(return_value=state);monkeypatch.setattr(service,'read_preview_state',read)
    result=service.preview_reset(SimpleNamespace(),user,settings,b'{}')
    assert {row.code for row in result.warnings}=={'PREVIEW_ONLY','RESET_ALL_DATA'}
    assert result.replacement_impact.would_create.model_dump()=={'transactions':0,'subscriptions':0,'budget_profiles':0,'preferences':0}
    claims=validate_preview_token(settings,result.preview_token,user,'reset',EMPTY_DOCUMENT_SHA256,state_sha256=state.sha256)
    assert claims['sid']==str(SID)


def test_state_domain_and_explicit_type_tags_match_independent_reference_for_empty_owner():
    from app.services.data_state import read_owner_state
    digest=hashlib.sha256(b'finance-dashboard:financial-state:v1\x00')
    frames=[[['str','owner'],['uuid',str(OWNER)]]]
    for name in ('transactions','subscriptions','budget_profiles','preferences'):
        frames.extend([[['str','table'],['str',name]],[['str','count'],['int',0]]])
    for frame in frames:
        raw=json.dumps(frame,ensure_ascii=False,separators=(',',':')).encode()
        digest.update(len(raw).to_bytes(8,'big'));digest.update(raw)
    assert read_owner_state(StateConnection(),OWNER).sha256==digest.hexdigest()

@pytest.fixture
def operation_api(operation_run,settings,user,monkeypatch):
    from fastapi.testclient import TestClient
    import app.main as main
    from app.auth import get_current_user
    from app.db import get_session
    engine=MagicMock();monkeypatch.setattr(main,'create_database_engine',lambda _:engine)
    app=main.create_app(settings)
    app.dependency_overrides[get_current_user]=lambda:user
    app.dependency_overrides[get_session]=lambda:operation_run.session
    with TestClient(app) as client:
        yield SimpleNamespace(client=client,app=app,engine=engine,run=operation_run)


def operation_headers(run):
    return {'Origin':'http://127.0.0.1:5173','X-CSRF-Protection':'1','Idempotency-Key':str(run.key),'Content-Type':'application/json'}


def test_actual_reset_http_uses_bound_key_returns_flat_receipt_and_privacy_headers(operation_api):
    api=operation_api
    response=api.client.post('/api/v1/data/reset',content=json.dumps(api.run.body),headers=operation_headers(api.run))
    assert response.status_code==200
    assert response.json()['idempotency_key']==str(api.run.key)
    assert response.json()['operation']=='reset' and response.json()['document_sha256'] is None
    assert response.headers['cache-control']=='no-store' and response.headers['pragma']=='no-cache'
    assert len(api.run.session.receipts)==1


@pytest.mark.parametrize('missing',['Origin','X-CSRF-Protection','Idempotency-Key'])
def test_write_guard_rejects_missing_csrf_origin_or_key_before_service_transaction(operation_api,missing):
    api=operation_api;headers=operation_headers(api.run);del headers[missing]
    response=api.client.post('/api/v1/data/reset',content=json.dumps(api.run.body),headers=headers)
    assert response.status_code==(422 if missing=='Idempotency-Key' else 403)
    assert api.run.session.events==[]
    assert set(response.json())=={'code','detail'}


def test_data_write_rate_limits_valid_attempts_but_ignores_cross_site_rejections(operation_api):
    api=operation_api;headers=operation_headers(api.run)
    for _ in range(7):
        rejected=api.client.post('/api/v1/data/reset',content=b'{}',headers=headers|{'Origin':'https://foreign.example'})
        assert rejected.status_code==403
    for _ in range(5):
        malformed=api.client.post('/api/v1/data/reset',content=b'{}',headers=headers)
        assert malformed.status_code==422
    limited=api.client.post('/api/v1/data/reset',content=b'{}',headers=headers)
    assert limited.status_code==429 and int(limited.headers['retry-after'])>0
    assert api.run.session.events==[]


def test_bulk_missing_authentication_never_calls_operation_service(operation_api):
    api=operation_api;api.app.dependency_overrides.clear()
    response=api.client.post('/api/v1/data/reset',content=b'{}',headers=operation_headers(api.run))
    assert response.status_code==401
    api.engine.connect.assert_not_called();assert api.run.session.events==[]


def test_canonical_lowercase_uuid_key_is_required(operation_api):
    api=operation_api;headers=operation_headers(api.run)|{'Idempotency-Key':str(api.run.key).upper()}
    response=api.client.post('/api/v1/data/reset',content=b'{}',headers=headers)
    assert response.status_code==422 and api.run.session.events==[]


@pytest.mark.parametrize('response_kind',['completed','not_observed','corrupt_key','corrupt_kind','corrupt_digest'])
def test_status_is_owner_scoped_readonly_and_only_returns_consistent_receipt(operation_run,settings,user,monkeypatch,response_kind):
    from app.data_operation_errors import DataOperationError
    run=operation_run;completed=reset(run,settings,user);receipt=run.session.receipts[0]
    data=SimpleNamespace(idempotency_key=receipt.idempotency_key,kind=receipt.kind,request_sha256=receipt.request_sha256,result_json=deepcopy(receipt.result_json))
    if response_kind=='corrupt_key':data.result_json['idempotency_key']=str(OTHER)
    if response_kind=='corrupt_kind':data.result_json['operation']='import_replace'
    if response_kind=='corrupt_digest':data.result_json['document_sha256']='f'*64
    events=[];conn=MagicMock();tx=conn.begin.return_value
    def execute(statement):
        sql=compile_sql(statement);events.append(sql)
        if sql.startswith('SET'):return Rows()
        assert sql.startswith('SELECT ') and '.owner_id = ' in sql
        assert OWNER in statement.compile().params.values() and run.key in statement.compile().params.values()
        return SimpleNamespace(one_or_none=lambda:None if response_kind=='not_observed' else data)
    conn.execute.side_effect=execute
    engine=MagicMock();engine.connect.return_value.__enter__.return_value=conn
    monkeypatch.setattr(run.service,'require_data_schema',lambda connection:None)
    if response_kind=='completed':assert run.service.get_operation(engine,user,run.key)==completed
    else:
        with pytest.raises(DataOperationError) as caught:run.service.get_operation(engine,user,run.key)
        assert caught.value.code==('OPERATION_NOT_OBSERVED' if response_kind=='not_observed' else 'DATA_OPERATION_FAILED')
    assert events[0]=='SET TRANSACTION READ ONLY'
    tx.rollback.assert_called_once_with();tx.commit.assert_not_called()


@pytest.mark.parametrize('method',['patch','delete'])
def test_patch_and_delete_lock_owner_before_record_lookup(method):
    import app.api.finance as routes
    from app.models import Transaction
    from app.schemas import TransactionPatch
    from datetime import date
    record=Transaction(id=uuid4(),owner_id=OWNER,title='Synthetic',amount_usd=Decimal('1'),type='income',category='Synthetic',transaction_date=date(2026,10,25),created_at=datetime.now(timezone.utc),updated_at=datetime.now(timezone.utc))
    session=MagicMock();session.scalar.side_effect=[OWNER,record]
    if method=='patch':routes.patch_transaction(record.id,TransactionPatch(title='Changed'),session,OWNER)
    else:routes.delete_transaction(record.id,session,OWNER)
    first,second=[compile_sql(call.args[0]) for call in session.scalar.call_args_list]
    assert 'FROM owners' in first and 'FOR UPDATE' in first
    assert 'FROM transactions' in second and '.owner_id = ' in second


def test_pure_get_does_not_take_owner_write_lock():
    from app.services.finance import get_record
    from app.models import Transaction
    session=MagicMock();session.scalar.return_value=SimpleNamespace(id=uuid4())
    get_record(session,Transaction,OWNER,uuid4())
    assert session.scalar.call_count==1 and 'FOR UPDATE' not in compile_sql(session.scalar.call_args.args[0])


def test_change_committed_while_owner_lock_waits_is_seen_before_any_dml(operation_run,settings,user):
    from app.data_operation_errors import DataOperationError
    run=operation_run;original=run.session.scalar
    def scalar(statement):
        value=original(statement)
        if 'FROM owners' in compile_sql(statement):
            # Simulate another owner-serialized writer committing before this lock is granted.
            run.session.records['transactions'][0]['title']='Committed by earlier writer'
            run.session.snapshot=deepcopy((run.session.records,run.session.receipts))
        return value
    run.session.scalar=scalar
    with pytest.raises(DataOperationError) as caught:reset(run,settings,user)
    assert caught.value.code=='STATE_CHANGED'
    assert run.session.records['transactions'][0]['title']=='Committed by earlier writer'
    assert not any(event.startswith('DELETE') for event in run.session.events)
    run.session.tx.commit.assert_not_called()


@pytest.mark.parametrize('constraint,code',[('uq_data_operation_receipts_owner_preview','PREVIEW_USED'),('pk_data_operation_receipts','IDEMPOTENCY_CONFLICT')])
def test_named_receipt_unique_violation_is_classified_only_after_complete_rollback(operation_run,settings,user,constraint,code):
    from sqlalchemy.exc import IntegrityError
    from app.data_operation_errors import DataOperationError
    run=operation_run;before=deepcopy(run.session.records);original=run.session.flush
    def flush():
        if run.session.flushes==1:
            raise IntegrityError(None,None,SimpleNamespace(sqlstate='23505',diag=SimpleNamespace(constraint_name=constraint)))
        original()
    run.session.flush=flush
    with pytest.raises(DataOperationError) as caught:run.service.apply_import(run.session,user,settings,import_body(run,settings,user),run.key)
    assert caught.value.status_code==409 and caught.value.code==code
    assert run.session.records==before and not run.session.receipts
    run.session.tx.rollback.assert_called_once_with();run.session.tx.commit.assert_not_called()
