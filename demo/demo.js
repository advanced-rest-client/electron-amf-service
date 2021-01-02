const { ElectronAmfService } = require('..');
const service = new ElectronAmfService();

/**
 * @param {any} message
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
  reportMessage('Processing the API');
  try {
    const model = await service.processApiFile(file);
    if (model) {
      reportMessage(model);
    } else {
      reportMessage(`Operation cancelled`);
    }
  } catch (e) {
    reportMessage(e.message);
    console.error(e);
  }
}

document.getElementById('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) {
    return;
  }
  processFile(file);
});
