const fs = require('fs');
const path = require('path');
const os = require('os');

describe('store save/load with mocked electron paths', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-test-'));
  const tmpUserData = path.join(tmp, 'userData');
  const tmpVideos = path.join(tmp, 'Videos');
  fs.mkdirSync(tmpUserData, { recursive: true });
  fs.mkdirSync(tmpVideos, { recursive: true });

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('electron', () => ({
      app: {
        getPath: (name) => {
          if (name === 'userData') return tmpUserData;
          if (name === 'videos') return tmpVideos;
          return tmpUserData;
        }
      }
    }));
    jest.doMock('../src/shared/cloudAuth', () => ({
      checkHardwareBan: () => Promise.resolve(null),
      getDeviceSessionWithRpcFallback: () => Promise.reject(new Error('Mock network failure')),
      loginUser: () => Promise.resolve({ success: false }),
      registerUser: () => Promise.resolve({ success: false })
    }));
  });

  test('saveData writes data file and reconstructProfilesFromDisk finds profile', async () => {
    const store = require('../src/main/store');
    const data = { profiles: [{ id: 'p1', name: 'TestProfile' }] };
    // Ensure videos/MediaVault exists for profile sync
    const mvRoot = path.join(tmpVideos, 'MediaVault');
    fs.mkdirSync(mvRoot, { recursive: true });

    // Call saveData and then loadData
    await store.saveData(data);
    const loaded = await store.loadData();

    expect(loaded).toBeDefined();
    expect(Array.isArray(loaded.profiles)).toBe(true);
    // The saved profiles should include our profile (either directly or via reconstruction)
    const found = loaded.profiles.find(p => p.name === 'TestProfile' || p.id === 'p1');
    expect(found).toBeTruthy();
  });
});
