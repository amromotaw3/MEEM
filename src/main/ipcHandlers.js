const { initUtilityIpc } = require('./ipc/utility');
const { initSubtitleIpc } = require('./ipc/subtitle');
const { initFileManageIpc } = require('./ipc/fileManage');
const { initProfileConfigIpc } = require('./ipc/profileConfig');
const { initMediaPlayIpc } = require('./ipc/mediaPlay');
const { initMetadataIpc } = require('./ipc/metadata');
const { initRadioIpc } = require('./ipc/radio');
const { initIptvIpc } = require('./ipc/iptv');
const { initYoutubeIpc } = require('./ipc/youtube');
const { initPatreonIpc } = require('./ipc/patreon');
const { initGumroadIpc } = require('./ipc/gumroad');
const { initMusicIpc } = require('./ipc/music');

function initMiscIpc(ipcMain) {
  initUtilityIpc(ipcMain);
  initSubtitleIpc(ipcMain);
  initFileManageIpc(ipcMain);
  initProfileConfigIpc(ipcMain);
  initMediaPlayIpc(ipcMain);
  initMetadataIpc(ipcMain);
  initRadioIpc(ipcMain);
  initIptvIpc(ipcMain);
  initYoutubeIpc(ipcMain);
  initMusicIpc(ipcMain);
  initPatreonIpc(ipcMain);
  initGumroadIpc(ipcMain);
}

module.exports = { initMiscIpc };
