// Observe the poll used to receive real updates. getMe alone cannot detect a polling conflict.
function observePolling(telegram, onConnected) {
  let lastSuccess = 0;
  const call = telegram.callApi.bind(telegram);
  telegram.callApi = async (method, data, ...args) => {
    if (method !== 'getUpdates' || data.timeout === undefined) return call(method, data, ...args);
    try {
      const updates = await call(method, lastSuccess ? data : { ...data, timeout: 0 }, ...args);
      await onConnected();
      lastSuccess = Date.now();
      return updates;
    } catch (err) {
      lastSuccess = 0;
      throw err;
    }
  };
  return {
    ready: () => lastSuccess > 0 && Date.now() - lastSuccess < 75000,
    reset: () => { lastSuccess = 0; }
  };
}
module.exports = { observePolling };
