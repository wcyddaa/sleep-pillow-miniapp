/**
 * 消息 Store：消息列表、未读计数、TabBar 角标
 */
const { createStore } = require('../index');

const store = createStore({
  messages: [],
  loaded: false
});

function unreadCount(state) {
  return state.messages.filter((m) => !m.read).length;
}

module.exports = {
  store,

  setMessages(list) {
    store.setState({ messages: list, loaded: true });
    this.updateTabBarBadge();
  },

  markRead(messageId) {
    store.setState({
      messages: store.state.messages.map((m) => (m.id === messageId ? Object.assign({}, m, { read: true }) : m))
    });
    this.updateTabBarBadge();
  },

  markAllRead() {
    store.setState({ messages: store.state.messages.map((m) => Object.assign({}, m, { read: true })) });
    this.updateTabBarBadge();
  },

  addMessage(msg) {
    const messages = [msg].concat(store.state.messages);
    store.setState({ messages });
    this.updateTabBarBadge();
  },

  unread() {
    return unreadCount(store.state);
  },

  /** 同步 TabBar 角标（消息 tab index=1） */
  updateTabBarBadge() {
    const count = unreadCount(store.state);
    if (typeof wx.setTabBarBadge !== 'function') return;
    if (count > 0) {
      wx.setTabBarBadge({ index: 1, text: count > 99 ? '99+' : String(count), fail: () => {} });
    } else {
      wx.removeTabBarBadge({ index: 1, fail: () => {} });
    }
  }
};
