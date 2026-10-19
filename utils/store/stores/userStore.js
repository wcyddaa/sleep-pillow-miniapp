/**
 * 用户 Store：用户信息、Token（本地持久化）
 */
const { createStore } = require('../index');
const { STORAGE_KEYS } = require('../../common/constants');
const envConfig = require('../../../config/envConfig');

const mockUser = {
  id: 'u_1001',
  nickname: '林小智',
  phone: '138****6688',
  avatar: '/assets/images/default/avatar.png',
  regTime: '2025-03-12'
};

function loadSaved() {
  try {
    const user = wx.getStorageSync(STORAGE_KEYS.USER);
    const token = wx.getStorageSync(STORAGE_KEYS.TOKEN);
    if (user && token) return { user, token, isLoggedIn: true };
  } catch (e) { /* ignore */ }
  return null;
}

const saved = loadSaved();
const useMockDefault = envConfig.useMock && !saved;

const store = createStore({
  user: saved ? saved.user : (useMockDefault ? mockUser : null),
  token: saved ? saved.token : (useMockDefault ? 'mock-token-1001' : ''),
  isLoggedIn: saved ? true : useMockDefault
});

function persist() {
  try {
    if (store.state.isLoggedIn) {
      wx.setStorageSync(STORAGE_KEYS.USER, store.state.user);
      wx.setStorageSync(STORAGE_KEYS.TOKEN, store.state.token);
    } else {
      wx.removeStorageSync(STORAGE_KEYS.USER);
      wx.removeStorageSync(STORAGE_KEYS.TOKEN);
    }
  } catch (e) { /* ignore */ }
}

module.exports = {
  store,

  setLogin(user, token) {
    store.setState({ user, token, isLoggedIn: true });
    persist();
  },

  logout() {
    store.setState({ user: null, token: '', isLoggedIn: false });
    persist();
  },

  updateProfile(patch) {
    store.setState({ user: Object.assign({}, store.state.user, patch) });
    persist();
  },

  /** 请求头用 */
  getToken() {
    return store.state.token;
  }
};
