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
        const amf = await service.processApiFile(buff);
        await service.unlisten();
        assert.typeOf(amf, 'array');
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
        const amf = await service.processApiFile(data);
        await service.unlisten();
        assert.typeOf(amf, 'array');
      });
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
