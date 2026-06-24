const { initUtilityIpc } = require('./ipc/utility');
const { initSubtitleIpc } = require('./ipc/subtitle');
const { initFileManageIpc } = require('./ipc/fileManage');
const { initProfileConfigIpc } = require('./ipc/profileConfig');
const { initMediaPlayIpc } = require('./ipc/mediaPlay');
const { initMetadataIpc } = require('./ipc/metadata');

function initMiscIpc(ipcMain) {
  initUtilityIpc(ipcMain);
  initSubtitleIpc(ipcMain);
  initFileManageIpc(ipcMain);
  initProfileConfigIpc(ipcMain);
  initMediaPlayIpc(ipcMain);
  initMetadataIpc(ipcMain);
}

module.exports = { initMiscIpc };
