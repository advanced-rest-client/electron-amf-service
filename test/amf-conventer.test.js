const {AmfConventer} = require('../lib/amf-converter.js');
const {assert} = require('chai');
const fs = require('fs-extra');

describe('AMF conventer', function() {
  describe('AMF to RAML', () => {
    let model;
    const FROM = 'amf';
    const TO = 'raml10';
    before(() => {
      return fs.readFile('test/demo-api.json', 'utf8')
      .then((api) => {
        model = api;
      });
    });

    it('Converts the model', () => {
      const instance = new AmfConventer();
      return instance.convert(FROM, TO, model)
      .then((result) => {
        console.log(result);
      });
    });
  });
});
