const { ElectronAmfService } = require('../');
const { assert } = require('chai');
const path = require('path');
const fs = require('fs-extra');

describe('File data processing', function() {
  describe('Blob data - parses to AMF', function() {
    function selectFileHandler(e) {
      e.preventDefault();
      e.detail.result = Promise.resolve(e.detail.candidates[0]);
    }
    before(() => {
      window.addEventListener('api-select-entrypoint', selectFileHandler);
    });

    after(() => {
      window.removeEventListener('api-select-entrypoint', selectFileHandler);
    });

    [
      ['Single RAML file', 'single-file-api.raml'],
      ['OAS 2.0', 'oas-2.0-json.zip'],
      ['Single RAML file in zip', 'single-file-api.zip'],
      ['Multiple RAML files in zip', 'multiple-raml-files.zip'],
      ['Folder in the zip', 'inception.zip'],
    ].forEach((item) => {
      it(item[0], async function() {
        const file = path.join('test', item[1]);
        const data = await fs.readFile(file);
        const buff = new Blob([new Uint8Array(data)]);
        const service = new ElectronAmfService();
        const result = await service.processApiFile(buff);
        await service.unlisten();
        assert.typeOf(result, 'object', 'Returns an object');
        assert.typeOf(result.model, 'string', 'Returns the model');
        assert.typeOf(result.type, 'object', 'Returns type info');
        assert.typeOf(result.type.type, 'string', 'API type is set');
        assert.typeOf(result.type.contentType, 'string', 'API content-type is set');
      });
    });
  });

  describe('Buffer data - parses to AMF', function() {
    function selectFileHandler(e) {
      e.preventDefault();
      e.detail.result = Promise.resolve(e.detail.candidates[0]);
    }
    before(() => {
      window.addEventListener('api-select-entrypoint', selectFileHandler);
    });

    after(() => {
      window.removeEventListener('api-select-entrypoint', selectFileHandler);
    });

    [
      ['Single RAML file', 'single-file-api.raml'],
      ['OAS 2.0', 'oas-2.0-json.zip'],
      ['Single RAML file in zip', 'single-file-api.zip'],
      ['Multiple RAML files in zip', 'multiple-raml-files.zip'],
      ['Folder in the zip', 'inception.zip'],
    ].forEach((item) => {
      it(item[0], async function() {
        const file = path.join('test', item[1]);
        const data = await fs.readFile(file);
        const service = new ElectronAmfService();
        const result = await service.processApiFile(data);
        await service.unlisten();
        assert.typeOf(result, 'object', 'Returns an object');
        assert.typeOf(result.model, 'string', 'Returns the model');
        assert.typeOf(result.type, 'object', 'Returns type info');
        assert.typeOf(result.type.type, 'string', 'API type is set');
        assert.typeOf(result.type.contentType, 'string', 'API content-type is set');
      });
    });
  });

  describe('Events API', () => {
    async function processApi(file) {
      const e = new CustomEvent('api-process-file', {
        bubbles: true,
        cancelable: true,
        detail: {
          // blob is a file or blob object. Any file object that is API file.
          // It also can be a Buffer
          file
        }
      });
      document.body.dispatchEvent(e);
      return await e.detail.result;
    }

    async function resolveApi(model, type) {
      const e = new CustomEvent('api-resolve-model', {
        bubbles: true,
        cancelable: true,
        detail: {
          model,
          type
        }
      });
      document.body.dispatchEvent(e);
      return await e.detail.result;
    }

    it('parses an API with api-process-file event', async () => {
      const service = new ElectronAmfService();
      service.listen();
      const file = path.join('test', 'single-file-api.raml');
      const data = await fs.readFile(file);
      const result = await processApi(data);
      assert.typeOf(result, 'object', 'Returns an object');
      assert.typeOf(result.model, 'string', 'Returns the model');
      assert.equal(result.type.type, 'RAML 1.0', 'API type is set');
      assert.equal(result.type.contentType, 'application/raml', 'API content-type is set');
    });

    it('resolves an API with api-resolve-model event', async () => {
      const service = new ElectronAmfService();
      service.listen();
      const file = path.join('test', 'single-file-api.raml');
      const data = await fs.readFile(file);
      const info = await processApi(data);
      const model = await resolveApi(info.model, info.type);
      assert.typeOf(model, 'string', 'has resolved model');
    });
  });

  describe('api-select-entrypoint event', function() {
    it('Dispatches event for multiple entry points', async function() {
      let called = false;
      window.addEventListener('api-select-entrypoint', function f(e) {
        window.removeEventListener('api-select-entrypoint', f);
        called = true;
        e.preventDefault();
        e.detail.result = Promise.resolve();
      });

      const file = path.join('test', 'multiple-entry-points.zip');
      const data = await fs.readFile(file);
      const service = new ElectronAmfService();
      await service.processApiFile(data);
      assert.isTrue(called);
    });
  });
});
