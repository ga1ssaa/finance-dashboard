"""Strict import preview checks: fake HTTP/SQL only, never database writes."""
from copy import deepcopy
import hashlib
import json
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.auth import AuthenticatedUser, get_current_user
from app.config import Settings

OWNER=UUID('ba30867d-9d03-4490-9d3e-af3a52451fe1')
OTHER=UUID('633f97df-30bf-435d-864b-2dc96c3fa682')


@pytest.fixture(autouse=True)
def no_live_io(monkeypatch):
    import psycopg
    import subprocess
    forbidden=MagicMock(side_effect=AssertionError('Live I/O forbidden in offline preview tests'))
    monkeypatch.setattr(psycopg,'connect',forbidden)
    monkeypatch.setattr(subprocess,'run',forbidden)
    monkeypatch.setattr(subprocess,'Popen',forbidden)


def document():
    return {'format':'finance-dashboard','schema_version':1,'exported_at':'2026-10-25T00:00:00Z','base_currency':'USD','data':{
        'transactions':[{'title':'Synthetic','amount_usd':'999999999999.99999999','type':'income','category':'Synthetic','transaction_date':'2026-10-25'}],
        'subscriptions':[{'service_name':'Synthetic','amount_usd':'0.00000000','next_payment_date':'2026-11-01','icon':'credit-card','status':'active'}],
        'budget':{'monthly_income_usd':'0.00000001','needs_spent_usd':'0.00000000','wants_spent_usd':'0.00000000','savings_usd':'0.00000000'},
        'preferences':{'display_currency':'EUR'}}}


def wrapped(value=None,raw_document=None,**changes):
    text=raw_document if raw_document is not None else json.dumps(document() if value is None else value,ensure_ascii=False,separators=(',',':'))
    return json.dumps({'mode':'replace','source_format':'v1','document':text}|changes,ensure_ascii=False).encode()


def parse(raw):
    from app.services.import_preview import parse_preview_request
    return parse_preview_request(raw)


def invalid(raw):
    # The public parser must reject malformed input before any service connection.
    from app.services.import_preview import PreviewInvalid, PreviewTooLarge
    with pytest.raises((PreviewInvalid,PreviewTooLarge)): parse(raw)


@pytest.mark.parametrize('field,value',[('schema_version',True),('schema_version',1.0),('schema_version','1'),('schema_version',2),('format','unknown'),('base_currency','EUR')])
def test_wrong_envelope_types_version_and_currency_rejected(field,value):
    value_doc=document();value_doc[field]=value
    invalid(wrapped(value_doc))


@pytest.mark.parametrize('path',[('format',),('schema_version',),('exported_at',),('base_currency',),('data',),('data','transactions'),('data','subscriptions'),('data','budget'),('data','preferences')])
def test_required_fields_have_no_implicit_defaults(path):
    value=document();parent=value
    for key in path[:-1]:parent=parent[key]
    del parent[path[-1]]
    invalid(wrapped(value))


@pytest.mark.parametrize('amount',['1','1.0','1.000000000','-0.00000000','-1.00000000','1e2','NaN','Infinity','1000000000000.00000000',1,1.5,None,True])
def test_money_requires_unsigned_fixed_eight_decimal_string(amount):
    value=document();value['data']['transactions'][0]['amount_usd']=amount
    invalid(wrapped(value))


@pytest.mark.parametrize('value',['2026-10-25','2026-10-25 00:00:00Z','2026-10-25T00:00:00','2026-10-25T05:00:00+05:00','2026-10-25T00:00:00+0000','2026-10-25T00:00:00.1234567Z','2026-W43-7T00:00:00Z','2026-02-30T00:00:00Z','2026-10-25T00:00:00z'])
def test_timestamp_strict_utc_spelling_not_permissive_iso(value):
    value_doc=document();value_doc['exported_at']=value
    invalid(wrapped(value_doc))


@pytest.mark.parametrize('value',['2026-02-30','20261025','2026-10-25T00:00:00Z','2026-W43-7',None,123])
def test_calendar_dates_are_strict(value):
    data=document();data['data']['transactions'][0]['transaction_date']=value
    invalid(wrapped(data))


@pytest.mark.parametrize('location,key',[('transaction','title'),('transaction','category'),('subscription','service_name'),('subscription','icon')])
@pytest.mark.parametrize('text',['\ud800','\udfff','nul\x00value'])
def test_escaped_surrogates_and_nul_rejected_at_all_text_fields(location,key,text):
    value=document();row=value['data']['transactions' if location=='transaction' else 'subscriptions'][0];row[key]=text
    # ensure_ascii deliberately makes lone surrogates valid UTF8 JSON bytes.
    invalid(wrapped(raw_document=json.dumps(value,ensure_ascii=True)))


@pytest.mark.parametrize('raw',[b'{"mode":"replace","mode":"replace","source_format":"v1","document":"{}"}',b'{"mode":"replace","source_format":"v1","document":"{}","\\u0064ocument":"{}"}',b'\xff',b'',b'\xef\xbb\xbf{}',b'{"mode":NaN}',b'{"mode":Infinity}',b'[]'])
def test_outer_strict_json_rejects_duplicates_constants_invalid_utf8_and_bom(raw):
    invalid(raw)


def test_nested_duplicate_keys_and_escaped_equivalence_are_rejected():
    raw=json.dumps(document(),separators=(',',':')).replace('"title":"Synthetic"','"title":"Synthetic","\\u0074itle":"different"')
    invalid(wrapped(raw_document=raw))


def test_valid_json_string_brackets_and_escaped_quotes_do_not_count_as_nesting():
    value=document();value['data']['transactions'][0]['title']='[{{[ escaped " quote ]}}]'
    parse(wrapped(value))


@pytest.mark.parametrize('modify',[lambda value:value.update({'owner_id':str(OTHER)}),lambda value:value['data']['transactions'][0].update({'id':str(OTHER)}),lambda value:value['data']['preferences'].update({'password':'synthetic-secret-marker'}),lambda value:value['data']['subscriptions'][0].update({'status':'cancelled'}),lambda value:value['data']['preferences'].update({'display_currency':'GBP'})])
def test_unknown_fields_ids_and_enums_rejected(modify):
    value=document();modify(value);invalid(wrapped(value))


@pytest.mark.parametrize('table,count',[('transactions',10001),('subscriptions',1001)])
def test_record_caps_reject_whole_document_not_truncate(table,count):
    value=document();value['data'][table]=[value['data'][table][0]]*count
    invalid(wrapped(value))

class CountEngine:
    def __init__(self,counts=None):
        self.counts=counts or {'transactions':{OWNER:7,OTHER:99},'subscriptions':{OWNER:3,OTHER:9},'budget_profiles':{OWNER:1,OTHER:1},'preferences':{OWNER:1,OTHER:1}}
        self.events=[];self.queries=[];self.readonly=False
        self.dispose=MagicMock()
        self.tx=MagicMock();self.tx.rollback.side_effect=lambda:self.events.append('rollback')
        self.conn=MagicMock()
        self.conn.__enter__.return_value=self.conn
        self.conn.__exit__.side_effect=lambda *args:self.events.append('close')
        self.conn.begin.side_effect=lambda:self.events.append('begin') or self.tx
        self.conn.execute.side_effect=self.control
        self.conn.scalar.side_effect=self.scalar
        self.connect=MagicMock(side_effect=lambda:self.events.append('connect') or self.conn)
    def control(self,statement):
        from sqlalchemy.sql.elements import TextClause
        from datetime import date,datetime,timezone
        from decimal import Decimal
        if isinstance(statement,TextClause):
            sql=str(statement)
            if sql.startswith('SET TRANSACTION'):
                assert not self.queries and sql=='SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
                self.events.append(sql);self.readonly=True
                return SimpleNamespace()
            assert self.readonly and 'alembic_version' in sql
            return SimpleNamespace(scalars=lambda:SimpleNamespace(all=lambda:['0004_data_operations']))
        assert self.readonly
        table=statement.get_final_froms()[0]
        class Result:
            def __init__(self,rows):self.rows=rows
            def __iter__(self):return iter(self.rows)
            def close(self):pass
        if table.name=='data_operation_receipts':
            assert statement._limit_clause.value==0
            return Result([])
        self.queries.append(statement)
        owners=[value for value in statement.compile().params.values() if isinstance(value,UUID)]
        rows=[]
        for owner,count in self.counts[table.name].items():
            if owner not in owners:continue
            for index in range(count):
                values={'id':UUID(int=index+1),'owner_id':owner,'created_at':datetime(2026,10,25,tzinfo=timezone.utc),'updated_at':datetime(2026,10,25,tzinfo=timezone.utc),'title':'Synthetic','category':'Synthetic','type':'income','amount_usd':Decimal('1.00000000'),'transaction_date':date(2026,10,25),'service_name':'Synthetic','next_payment_date':date(2026,11,1),'icon':'credit-card','status':'active','display_currency':'USD','monthly_income_usd':Decimal('0'),'needs_spent_usd':Decimal('0'),'wants_spent_usd':Decimal('0'),'savings_usd':Decimal('0')}
                rows.append(tuple(values[column.name] for column in statement.selected_columns))
        return Result(rows)
    def scalar(self,statement):
        assert self.readonly,'Snapshot mode must precede every count'
        sql=str(statement.compile(dialect=postgresql.dialect()))
        assert sql.startswith('SELECT count('),'Preview may execute only owner COUNT reads'
        table=statement.get_final_froms()[0].name
        params=statement.compile().params
        owners=[value for value in params.values() if isinstance(value,UUID)]
        self.queries.append(statement)
        if not owners:return sum(self.counts[table].values())
        return self.counts[table].get(owners[0],0)


def preview(engine,raw=None):
    from app.services.import_preview import preview_owner_import
    settings=Settings(_env_file=None,DATABASE_URL='postgresql+psycopg://synthetic:unused@127.0.0.1:65432/unused')
    user=AuthenticatedUser(id=UUID(int=222),email='synthetic@example.test',owner_id=OWNER,session_id=UUID(int=333))
    return preview_owner_import(engine,user,wrapped() if raw is None else raw,settings=settings)


def test_valid_preview_is_exact_summary_raw_digest_and_one_rollback_only_owner_snapshot():
    engine=CountEngine();raw=wrapped();result=preview(engine,raw).model_dump(mode='json')
    assert set(result)=={'validation_status','document_sha256','source','current','replacement_impact','warnings','preview_token','expires_at'}
    assert result['document_sha256']==hashlib.sha256(json.loads(raw)['document'].encode()).hexdigest()
    assert result['source']['counts']=={'transactions':1,'subscriptions':1,'budget_profiles':1,'preferences':1}
    assert result['current']['counts']=={'transactions':7,'subscriptions':3,'budget_profiles':1,'preferences':1}
    assert result['replacement_impact']=={'would_remove':result['current']['counts'],'would_create':result['source']['counts']}
    assert {warning['code'] for warning in result['warnings']}=={'PREVIEW_ONLY','REPLACE_ALL_DATA'}
    assert 'Synthetic' not in json.dumps(result)
    assert not {'token','receipt','state_hash','owner_id','user_id'} & result.keys()
    assert engine.events==['connect','begin','SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY','rollback','close']
    assert len(engine.queries)==4
    engine.tx.commit.assert_not_called()
    for statement in engine.queries:
        sql=str(statement.compile(dialect=postgresql.dialect()))
        assert '.owner_id = ' in sql and OWNER in statement.compile().params.values()
        assert statement.get_final_froms()[0].name in {'transactions','subscriptions','budget_profiles','preferences'}


def test_empty_source_warns_about_replacement_and_missing_singletons_without_defaults():
    value=document();value['data']={'transactions':[],'subscriptions':[],'budget':None,'preferences':None}
    engine=CountEngine();result=preview(engine,wrapped(value)).model_dump()
    assert result['source']['counts']=={'transactions':0,'subscriptions':0,'budget_profiles':0,'preferences':0}
    assert {warning['code'] for warning in result['warnings']}=={'PREVIEW_ONLY','REPLACE_ALL_DATA','EMPTY_SOURCE','BUDGET_ABSENT','PREFERENCES_ABSENT'}
    assert len(engine.queries)==4


def test_invalid_input_does_not_acquire_financial_connection():
    from app.services.import_preview import PreviewInvalid
    engine=CountEngine()
    with pytest.raises(PreviewInvalid):preview(engine,b'{}')
    engine.connect.assert_not_called()


@pytest.mark.parametrize('count',[2,3])
def test_duplicate_singleton_state_rolls_back_and_returns_no_preview(count):
    engine=CountEngine();engine.counts['preferences'][OWNER]=count
    from pydantic import ValidationError
    with pytest.raises(ValidationError):preview(engine)
    engine.tx.rollback.assert_called_once_with();engine.tx.commit.assert_not_called()
    assert engine.events[-1]=='close'


def test_count_query_failure_rolls_back_without_commit_or_retry():
    engine=CountEngine();original=engine.control
    def failure(statement):
        if not str(statement).startswith('SET TRANSACTION'):raise RuntimeError('synthetic query failure')
        return original(statement)
    engine.conn.execute.side_effect=failure
    with pytest.raises(RuntimeError):preview(engine)
    assert engine.connect.call_count==1
    engine.tx.rollback.assert_called_once_with();engine.tx.commit.assert_not_called()
    assert engine.events[-1]=='close'


@pytest.mark.parametrize('table,count',[('transactions',10000),('subscriptions',1000)])
def test_exact_record_caps_preserve_legitimate_identical_rows(table,count):
    value=document();value['data'][table]=[value['data'][table][0]]*count
    result=preview(CountEngine(),wrapped(value)).model_dump()
    assert result['source']['counts'][table]==count


def test_raw_document_digest_preserves_whitespace_and_unicode_bytes():
    value=document();value['data']['transactions'][0]['title']='Synthetic 😀'
    inner=' \n'+json.dumps(value,ensure_ascii=False)+'\n '
    result=parse(wrapped(raw_document=inner))
    assert result.document_sha256==hashlib.sha256(inner.encode('utf-8')).hexdigest()
    assert result.document_sha256!=hashlib.sha256(inner.strip().encode('utf-8')).hexdigest()


def test_depth_eight_allowed_nine_rejected_before_recursive_json_parse(monkeypatch):
    import app.services.import_preview as service
    raw8=b'['*8+b'0'+b']'*8
    assert service._load_json(raw8)==[[[[[[[[0]]]]]]]]
    called=MagicMock(side_effect=AssertionError('Recursive JSON parser must not receive over-depth input'))
    monkeypatch.setattr(service.json,'loads',called)
    with pytest.raises(service.PreviewInvalid):service._load_json(b'['*9+b'0'+b']'*9)
    called.assert_not_called()


def test_real_document_byte_limit_accepts_boundary_and_rejects_plus_one_before_connect():
    from app.services.import_preview import MAX_DOCUMENT_BYTES,PreviewTooLarge
    inner=json.dumps(document(),ensure_ascii=False)
    exact=inner+' '*(MAX_DOCUMENT_BYTES-len(inner.encode()))
    assert parse(wrapped(raw_document=exact)).document_sha256==hashlib.sha256(exact.encode()).hexdigest()
    engine=CountEngine()
    with pytest.raises(PreviewTooLarge):preview(engine,wrapped(raw_document=exact+' '))
    engine.connect.assert_not_called()


def test_actual_outer_byte_limit_accepts_boundary_and_rejects_plus_one():
    from app.services.import_preview import MAX_REQUEST_BYTES,PreviewTooLarge
    raw=wrapped();exact=raw+b' '*(MAX_REQUEST_BYTES-len(raw))
    parse(exact)
    with pytest.raises(PreviewTooLarge):parse(exact+b' ')

@pytest.fixture
def api(monkeypatch):
    import app.main as application
    import app.api.data as route
    engine=CountEngine()
    monkeypatch.setattr(application,'create_database_engine',lambda _:engine)
    app=application.create_app(Settings(_env_file=None,DATABASE_URL='postgresql+psycopg://synthetic:unused@127.0.0.1:65432/unused'))
    app.dependency_overrides[get_current_user]=lambda:AuthenticatedUser(id=uuid4(),email='synthetic@example.test',owner_id=OWNER,session_id=UUID(int=333))
    with TestClient(app) as client:
        yield SimpleNamespace(client=client,engine=engine,route=route,app=app)


def private(response):
    assert response.headers['cache-control']=='no-store'
    assert response.headers['pragma']=='no-cache'
    assert response.headers['x-content-type-options']=='nosniff'


def test_authenticated_http_preview_returns_summary_only_without_writing(api):
    response=api.client.post('/api/v1/data/import/preview',content=wrapped(),headers={'Content-Type':'application/json'})
    assert response.status_code==200;private(response)
    assert response.json()['validation_status']=='valid'
    assert response.json()['current']['counts']['transactions']==7
    assert set(response.json())=={'validation_status','document_sha256','source','current','replacement_impact','warnings','preview_token','expires_at'}
    api.engine.tx.commit.assert_not_called()


def test_unauthenticated_preview_never_acquires_financial_connection_or_calls_service(api,monkeypatch):
    forbidden=MagicMock(side_effect=AssertionError('No unauthenticated preview'))
    monkeypatch.setattr(api.route,'preview_owner_import',forbidden)
    api.app.dependency_overrides.clear()
    response=api.client.post('/api/v1/data/import/preview',content=wrapped(),headers={'Content-Type':'application/json'})
    assert response.status_code==401;private(response)
    forbidden.assert_not_called();api.engine.connect.assert_not_called()


@pytest.mark.parametrize('raw',[b'{}',b'{"PRIVATE_UNKNOWN_FIELD_MARKER":"PRIVATE_VALUE_MARKER"}',b'{"PRIVATE_DUP_KEY":"value","PRIVATE_DUP_KEY":"another"}',b'\xff'])
def test_invalid_http_payload_returns_generic_errors_without_echoing_inputs_or_unknown_key_names(api,raw):
    response=api.client.post('/api/v1/data/import/preview',content=raw,headers={'Content-Type':'application/json'})
    assert response.status_code==422;private(response)
    assert response.json()=={'detail':'Invalid import preview document'}
    assert 'PRIVATE_' not in response.text and 'input' not in response.text and 'loc' not in response.text
    api.engine.connect.assert_not_called()


def test_validation_checks_inner_unknown_secret_keys_without_echoing_them(api):
    value=document();value['data']['preferences']['PRIVATE_PASSWORD_KEY']='PRIVATE_VALUE_MARKER'
    response=api.client.post('/api/v1/data/import/preview',content=wrapped(value),headers={'Content-Type':'application/json'})
    assert response.status_code==422
    assert 'PRIVATE_' not in response.text;api.engine.connect.assert_not_called()


@pytest.mark.parametrize('query,content_type,status',[('?owner_id='+str(OTHER),'application/json',422),('?limit=1','application/json',422),('','text/plain',415)])
def test_client_scope_and_wrong_media_type_rejected_before_financial_queries(api,query,content_type,status):
    response=api.client.post('/api/v1/data/import/preview'+query,content=wrapped(),headers={'Content-Type':content_type})
    assert response.status_code==status;private(response);api.engine.connect.assert_not_called()


def test_http_actual_chunk_size_not_content_length_controls_cap(monkeypatch):
    import asyncio
    import app.api.data as route
    from fastapi import HTTPException
    consumed=[];engine=CountEngine()
    async def stream():
        consumed.append('one');yield b'x'*10
        consumed.append('two');yield b'x'*11
        consumed.append('three');raise AssertionError('Do not drain an oversized stream')
    request=SimpleNamespace(query_params={},headers={'content-type':'application/json','content-length':'1'},stream=stream,app=SimpleNamespace(state=SimpleNamespace(engine=engine)))
    monkeypatch.setattr(route,'MAX_REQUEST_BYTES',20)
    with pytest.raises(HTTPException) as caught:asyncio.run(route.import_preview(request,AuthenticatedUser(id=UUID(int=222),email='synthetic@example.test',owner_id=OWNER,session_id=UUID(int=333))))
    assert caught.value.status_code==413 and consumed==['one','two']
    engine.connect.assert_not_called()


def test_database_failure_is_sanitized_and_rolls_back_preview(api):
    from sqlalchemy.exc import OperationalError
    original=api.engine.control
    def fail(statement):
        if not str(statement).startswith('SET TRANSACTION'):raise OperationalError(None,None,Exception('PRIVATE_DRIVER_DATA_MARKER'))
        return original(statement)
    api.engine.conn.execute.side_effect=fail
    response=api.client.post('/api/v1/data/import/preview',content=wrapped(),headers={'Content-Type':'application/json'})
    assert response.status_code==503;private(response)
    assert 'PRIVATE_' not in response.text
    api.engine.tx.rollback.assert_called_once_with();api.engine.tx.commit.assert_not_called()


def test_preview_has_no_import_confirm_reset_or_legacy_execution_routes(api):
    schema=api.client.get('/openapi.json').json()
    paths={path for path in schema['paths'] if path.startswith('/api/v1/data/')}
    assert paths=={'/api/v1/data/export','/api/v1/data/import/preview','/api/v1/data/reset/preview','/api/v1/data/import','/api/v1/data/reset','/api/v1/data/operations/{key}'}
    assert set(schema['paths']['/api/v1/data/import/preview'])=={'post'}
    for path in ('/api/v1/data/import/confirm','/api/v1/data/import/legacy'):
        assert api.client.post(path,json={}).status_code==404
    api.engine.connect.assert_not_called()


@pytest.mark.parametrize('stamp',['2026-10-25T00:00:00.1Z','2026-10-25T00:00:00.123456+00:00','2026-10-25T00:00:00+00:00'])
def test_valid_strict_utc_metadata_preserved_without_conversion(stamp):
    value=document();value['exported_at']=stamp
    assert parse(wrapped(value)).document.exported_at==stamp


@pytest.mark.parametrize('collection,field',[('transactions','title'),('transactions','amount_usd'),('transactions','type'),('transactions','category'),('transactions','transaction_date'),('subscriptions','service_name'),('subscriptions','icon'),('subscriptions','status')])
def test_business_row_required_fields_are_not_defaulted(collection,field):
    value=document();del value['data'][collection][0][field];invalid(wrapped(value))


@pytest.mark.parametrize('changes',[{'mode':'append'},{'source_format':'legacy'},{'document':{}},{'owner_id':str(OTHER)},{'preview_token':'synthetic'}])
def test_outer_request_only_allows_replace_v1_raw_string_without_write_authorization(changes):
    invalid(wrapped(**changes))


def test_zero_transaction_rejected_while_budget_and_subscription_zero_are_valid():
    value=document();parse(wrapped(value))
    value['data']['transactions'][0]['amount_usd']='0.00000000';invalid(wrapped(value))


def test_brackets_escaped_quotes_and_digit_strings_are_data_not_depth_or_numeric_lexemes():
    value=document();value['data']['transactions'][0]['title']='\\" [{{}}] '+'9'*100
    parse(wrapped(value))


@pytest.mark.parametrize('shape',['flat_objects','flat_numbers','unknown_keys'])
def test_flat_allocation_budget_stops_before_json_decoding(shape,monkeypatch):
    import app.services.import_preview as service
    maximum=service.MAX_JSON_TOKENS
    if shape=='flat_objects':raw=b'['+b','.join([b'{}']*maximum)+b']'
    elif shape=='flat_numbers':raw=b'['+b','.join([b'0']*maximum)+b']'
    else:raw=b'{'+b','.join(('"k'+str(n)+'":0').encode() for n in range(maximum//2+1))+b'}'
    loads=MagicMock(side_effect=AssertionError('Over-budget flat JSON must not reach recursive allocation'))
    monkeypatch.setattr(service.json,'loads',loads)
    with pytest.raises(service.PreviewInvalid):service._load_json(raw)
    loads.assert_not_called()


def test_inner_allocation_budget_only_decodes_outer_wrapper_before_rejection(monkeypatch):
    import app.services.import_preview as service
    inner='['+','.join(['{}']*service.MAX_JSON_TOKENS)+']'
    raw=wrapped(raw_document=inner)
    original=service.json.loads
    calls=[]
    def loads(value,**options):
        calls.append(value)
        assert len(calls)==1,'Overbudget inner document must not be allocated'
        return original(value,**options)
    monkeypatch.setattr(service.json,'loads',loads)
    engine=CountEngine()
    with pytest.raises(service.PreviewInvalid):preview(engine,raw)
    assert len(calls)==1;engine.connect.assert_not_called()


def test_numeric_lexeme_length_bounded_before_integer_conversion():
    import app.services.import_preview as service
    assert service._load_json(b'9'*32)==int('9'*32)
    with pytest.raises(service.PreviewInvalid):service._load_json(b'9'*33)
    with pytest.raises(service.PreviewInvalid):service._load_json(b'9'*10000)


def test_both_maximum_valid_collections_fit_preparse_allocation_budget():
    value=document();value['data']['transactions']*=10000;value['data']['subscriptions']*=1000
    parsed=parse(wrapped(value))
    assert len(parsed.document.data.transactions)==10000
    assert len(parsed.document.data.subscriptions)==1000
