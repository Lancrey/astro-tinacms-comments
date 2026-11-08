import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8');
const now = Date.UTC(2026, 0, 1);

function loadScript(clock = now, secret = 'test-secret') {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() { return clock; }
  }

  const context = {
    Date: FixedDate,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => key === 'SECRET_TOKEN' ? secret : '',
      }),
    },
    Utilities: {
      MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
      computeHmacSignature: (algorithm, message, key) => {
        assert.equal(algorithm, 'HMAC_SHA_256');
        return [...createHmac('sha256', key).update(message).digest()];
      },
      base64Encode: (data) => Buffer.from(data).toString('base64'),
      base64Decode: (value) => [...Buffer.from(value, 'base64')],
      newBlob: (bytes) => ({
        getDataAsString: () => Buffer.from(bytes).toString('utf8'),
      }),
    },
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('CAPTCHA token hides the answer while accepting the correct choice', () => {
  const api = loadScript();
  const token = api.createCaptchaToken('17', 'Éléphant');
  const payload = Buffer.from(token.split('.')[0], 'base64').toString('utf8');

  assert.equal(payload, '17|' + (now + 10 * 60 * 1000));
  assert.ok(!token.includes('Éléphant'));
  assert.ok(!payload.includes('Éléphant'));
  assert.equal(api.verifyCaptchaToken(token, ' ÉLÉPHANT '), true);
  assert.equal(api.verifyCaptchaToken(token, 'Chat'), false);
});

test('CAPTCHA signature binds both the ID and answer', () => {
  const api = loadScript();
  const token = api.createCaptchaToken('17', 'Floor');
  const parts = token.split('.');

  assert.equal(api.verifyCaptchaToken(token, 'Floor'), true);
  assert.equal(api.verifyCaptchaToken(token, 'Rain'), false);
  assert.equal(
    api.verifyCaptchaToken(Buffer.from('18|' + (now + 600000)).toString('base64') + '.' + parts[1], 'Floor'),
    false
  );
  assert.equal(api.verifyCaptchaToken(parts[0] + '.invalid-signature', 'Floor'), false);
});

test('CAPTCHA tokens expire after ten minutes', () => {
  const issued = loadScript();
  const token = issued.createCaptchaToken('17', 'Floor');

  assert.equal(loadScript(now + 600000).verifyCaptchaToken(token, 'Floor'), true);
  assert.equal(loadScript(now + 600001).verifyCaptchaToken(token, 'Floor'), false);
});

test('malformed tokens and missing secrets fail closed', () => {
  const api = loadScript();
  const token = api.createCaptchaToken('17', 'Floor');

  assert.equal(api.verifyCaptchaToken('', 'Floor'), false);
  assert.equal(api.verifyCaptchaToken('garbage', 'Floor'), false);
  assert.equal(api.verifyCaptchaToken(token, ''), false);
  assert.equal(loadScript(now, '').verifyCaptchaToken(token, 'Floor'), false);
  assert.throws(() => loadScript(now, '').createCaptchaToken('17', 'Floor'), /SECRET_TOKEN/);
});
