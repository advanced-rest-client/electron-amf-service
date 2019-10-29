const { ElectronAmfService } = require('..');
const service = new ElectronAmfService();
service.listen();
/**
 * @param {String} message
 */
function reportMessage(message) {
  const node = document.getElementById('out');
  if (message && typeof message !== 'string') {
    message = JSON.stringify(message, null, 2);
  }
  node.innerText = message;
}
/**
 * @param {File} file
 * @return {Promise}
 */
async function processFile(file) {
  const e = new CustomEvent('api-process-file', {
    bubbles: true,
    cancelable: true,
    detail: {
      file,
    },
  });
  document.body.dispatchEvent(e);
  if (!e.defaultPrevented) {
    reportMessage('The event was not handled');
    return;
  }
  reportMessage('Processing the API');
  try {
    const model = await e.detail.result;
    reportMessage(model);
  } catch (e) {
    reportMessage(e.message);
    console.error(e);
  }
}

let promiseResolver;
function selectFileHandler(e) {
  if (e.defaultPrevented) {
    return;
  }
  e.preventDefault();
  document.getElementById('confirmBtn').value = 'default';
  const f = document.createDocumentFragment();
  f.appendChild(document.createElement('option'));
  e.detail.candidates.forEach((file) => {
    const o = document.createElement('option');
    o.innerText = file;
    f.appendChild(o);
  });
  const selector = document.querySelector('select[name="files"]');
  selector.innerHTML = '';
  selector.appendChild(f);
  const dialog = document.getElementById('filesDialog');
  dialog.showModal();
  e.detail.result = new Promise((resolve) => {
    promiseResolver = resolve;
  })
}

document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) {
    return;
  }
  processFile(file);
});
window.addEventListener('api-select-entrypoint', selectFileHandler);
document.getElementById('filesDialog').onclose = (e) => {
  const file = e.target.returnValue;
  if (file === 'default') {
    promiseResolver();
  } else {
    promiseResolver(file);
  }
};
document.querySelector('select[name="files"]').onchange = (e) => {
  document.getElementById('confirmBtn').value = e.target.value;
};
