/**
 * 消息通知接口
 */
const http = require('../httpClient');
const messageStore = require('../../store/stores/messageStore');

/** 后端 UserMessageOut -> 前端 message 对象 */
const normalMessage = (m) => ({
  id: m.id,
  type: m.type,            // device_offline | snore_heavy | apnea_high | report_ready | device_bound
  severity: m.severity,    // info | warning | error
  title: m.title,
  content: m.content,
  refDeviceId: m.ref_device_id,
  refRecordId: m.ref_record_id,
  refFrameId: m.ref_frame_id,
  read: m.read_at != null,
  createdAt: m.created_at,
  createdAtText: m.created_at ? _fmtTime(m.created_at) : ''
});

function _fmtTime(s) {
  // s 形如 "2026-10-17T12:34:56.789+00:00" 或 Date
  const d = s instanceof Date ? s : new Date(s);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

module.exports = {
  /** 拉取消息列表（写入 messageStore） */
  fetchList() {
    return http.get('/messages', { limit: 50, offset: 0 })
      .then((payload) => {
        const items = (payload && payload.items) || [];
        const list = items.map(normalMessage);
        messageStore.setMessages(list);
        return list;
      })
      .catch(() => {
        messageStore.setMessages([]);
        return [];
      });
  },

  /** 标记单条已读 */
  markRead(messageId) {
    messageStore.markRead(messageId);
    return http.post('/messages/' + messageId + '/read', {})
      .catch(() => ({ ok: false }));
  },

  /** 全部已读 */
  markAllRead() {
    messageStore.markAllRead();
    return http.post('/messages/read-all', {})
      .catch(() => ({ ok: false }));
  },

  /** 推送开关设置（保留兼容壳，后端无此接口时静默成功） */
  setPushEnabled(scene, enabled) {
    return Promise.resolve({ success: true, scene, enabled });
  }
};
