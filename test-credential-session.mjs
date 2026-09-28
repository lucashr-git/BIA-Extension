import { createCredentialSession, requireCredentialSession, invalidateCredentialSession } from './src/background/state.js';
import assert from 'node:assert';

const URL_OK = 'chrome-extension://abc/src/sidepanel/sidepanel.html';
const port = { name: 'p' };

// O caso do bug: side panel sem documentId. Antes createCredentialSession devolvia null.
const id = createCredentialSession(port, undefined, URL_OK, ' jwt-token ');
assert.ok(id, 'sessao deve ser criada sem documentId');
assert.equal(requireCredentialSession({ credentialSessionId: id }, { url: URL_OK }).apiKey, 'jwt-token');

// E o vinculo continua valendo: outra origem nao usa a sessao.
assert.equal(requireCredentialSession({ credentialSessionId: id }, { url: 'chrome-extension://abc/evil.html' }).error, 'credential_required');
assert.equal(requireCredentialSession({ credentialSessionId: 'outro' }, { url: URL_OK }).error, 'credential_required');
invalidateCredentialSession(id);
assert.equal(requireCredentialSession({ credentialSessionId: id }, { url: URL_OK }).error, 'credential_required');

// Com documentId presente (frame de conteudo), a comparacao segue exata.
const id2 = createCredentialSession(port, 'doc-1', URL_OK, 'k');
assert.equal(requireCredentialSession({ credentialSessionId: id2 }, { url: URL_OK, documentId: 'doc-1' }).apiKey, 'k');
assert.equal(requireCredentialSession({ credentialSessionId: id2 }, { url: URL_OK, documentId: 'doc-2' }).error, 'credential_required');

// Credencial vazia continua rejeitada.
assert.equal(createCredentialSession(port, undefined, URL_OK, '   '), null);
assert.equal(createCredentialSession(port, undefined, '', 'k'), null);
console.log('ok');
