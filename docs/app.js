(() => {
  const STORAGE_TIMER_KEY = '700b_migaki_timer_v1';
  const STORAGE_QUEUE_KEY = '700b_migaki_queue_v1';
  const STORAGE_FAILED_KEY = '700b_migaki_failed_v1';
  const STORAGE_TOKEN_KEY = '700b_migaki_token_v1';
  const STORAGE_GAS_URL_KEY = '700b_migaki_gas_url_v1';
  const COLORS = ['1F7', '1G3', '4V8'];
  const PRODUCTS = ['RH', 'LH', 'No1', 'CTB'];

  const state = {
    timer: {
      status: 'idle', // 'idle' | 'running' | 'paused'
      color: null,
      product: null,
      startTimeIso: null,
      lastResumedAtMs: null,
      accumulatedActiveMs: 0,
    },
    isProcessingQueue: false,
    sendQueue: [],
    failedQueue: [],
    todayData: null,
    tickHandle: null,
    modalSelection: {
      color: '1F7',
      product: 'RH',
      isThrough: false,
    },
  };

  // DOM Elements
  const el = {
    syncStatusPill: document.getElementById('syncStatusPill'),
    todayDateLabel: document.getElementById('todayDateLabel'),
    refreshBtn: document.getElementById('refreshBtn'),
    authSettingsBtn: document.getElementById('authSettingsBtn'),
    configBanner: document.getElementById('configBanner'),
    configBannerText: document.getElementById('configBannerText'),
    retryBanner: document.getElementById('retryBanner'),
    retryErrorText: document.getElementById('retryErrorText'),
    retrySendBtn: document.getElementById('retrySendBtn'),
    discardPendingBtn: document.getElementById('discardPendingBtn'),
    colorBtns: document.querySelectorAll('[data-color]'),
    productBtns: document.querySelectorAll('[data-product]'),
    timerBox: document.getElementById('timerBox'),
    timerStatusBadge: document.getElementById('timerStatusBadge'),
    timerSelectionSummary: document.getElementById('timerSelectionSummary'),
    timerValue: document.getElementById('timerValue'),
    idleControls: document.getElementById('idleControls'),
    activeControls: document.getElementById('activeControls'),
    startBtn: document.getElementById('startBtn'),
    pauseResumeBtn: document.getElementById('pauseResumeBtn'),
    completeNormalBtn: document.getElementById('completeNormalBtn'),
    completeThroughBtn: document.getElementById('completeThroughBtn'),
    kpiTotalTime: document.getElementById('kpiTotalTime'),
    kpiTotalCount: document.getElementById('kpiTotalCount'),
    kpiThroughSub: document.getElementById('kpiThroughSub'),
    matrixBody: document.getElementById('matrixBody'),
    historyEmpty: document.getElementById('historyEmpty'),
    historyList: document.getElementById('historyList'),
    manualAddBtn: document.getElementById('manualAddBtn'),
    authModal: document.getElementById('authModal'),
    authForm: document.getElementById('authForm'),
    authErrorMsg: document.getElementById('authErrorMsg'),
    authGasUrl: document.getElementById('authGasUrl'),
    authTokenInput: document.getElementById('authTokenInput'),
    closeAuthModalBtn: document.getElementById('closeAuthModalBtn'),
    saveAuthBtn: document.getElementById('saveAuthBtn'),
    recordModal: document.getElementById('recordModal'),
    recordModalTitle: document.getElementById('recordModalTitle'),
    recordForm: document.getElementById('recordForm'),
    modalMode: document.getElementById('modalMode'),
    modalRecordId: document.getElementById('modalRecordId'),
    modalDurationSec: document.getElementById('modalDurationSec'),
    modalMemo: document.getElementById('modalMemo'),
    closeRecordModalBtn: document.getElementById('closeRecordModalBtn'),
    cancelRecordModalBtn: document.getElementById('cancelRecordModalBtn'),
    saveRecordModalBtn: document.getElementById('saveRecordModalBtn'),
    deleteModal: document.getElementById('deleteModal'),
    deleteForm: document.getElementById('deleteForm'),
    deleteRecordId: document.getElementById('deleteRecordId'),
    deleteTargetSummary: document.getElementById('deleteTargetSummary'),
    deleteMemo: document.getElementById('deleteMemo'),
    closeDeleteModalBtn: document.getElementById('closeDeleteModalBtn'),
    cancelDeleteModalBtn: document.getElementById('cancelDeleteModalBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    toast: document.getElementById('toast'),
  };

  function getGasUrl() {
    const fromConfig = (window.APP_CONFIG && window.APP_CONFIG.GAS_WEB_APP_URL) || '';
    const fromStorage = localStorage.getItem(STORAGE_GAS_URL_KEY) || '';
    return (fromStorage || fromConfig).trim();
  }

  function getToken() {
    return (localStorage.getItem(STORAGE_TOKEN_KEY) || '').trim();
  }

  function saveAuth(gasUrl, token) {
    try {
      if (gasUrl) {
        localStorage.setItem(STORAGE_GAS_URL_KEY, gasUrl.trim());
      }
      if (token) {
        localStorage.setItem(STORAGE_TOKEN_KEY, token.trim());
      }
    } catch {
      // ignore
    }
  }

  function openAuthModal(errorMessage = '', allowClose = false) {
    el.authGasUrl.value = getGasUrl();
    el.authTokenInput.value = getToken();
    if (errorMessage) {
      el.authErrorMsg.textContent = errorMessage;
      el.authErrorMsg.classList.remove('hidden');
    } else {
      el.authErrorMsg.classList.add('hidden');
    }
    el.closeAuthModalBtn.classList.toggle('hidden', !allowClose);
    el.authModal.classList.remove('hidden');
  }

  function closeAuthModal() {
    el.authModal.classList.add('hidden');
  }

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => el.toast.classList.add('hidden'), 2200);
  }

  function formatMmSs(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function formatHmsJapanese(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}時間${m}分${s}秒`;
  }

  function formatTimeHms(dateObj) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(dateObj);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const hh = map.hour === '24' ? '00' : map.hour;
    return `${hh}:${map.minute}:${map.second}`;
  }

  function getActiveMs() {
    const t = state.timer;
    if (t.status === 'running' && t.lastResumedAtMs) {
      return t.accumulatedActiveMs + Math.max(0, Date.now() - t.lastResumedAtMs);
    }
    return t.accumulatedActiveMs;
  }

  function saveTimerToStorage() {
    try {
      localStorage.setItem(STORAGE_TIMER_KEY, JSON.stringify(state.timer));
    } catch {
      // ignore
    }
  }

  function loadTimerFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_TIMER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.timer = {
          status: parsed.status || 'idle',
          color: COLORS.includes(parsed.color) ? parsed.color : null,
          product: PRODUCTS.includes(parsed.product) ? parsed.product : null,
          startTimeIso: parsed.startTimeIso || null,
          lastResumedAtMs: parsed.lastResumedAtMs || null,
          accumulatedActiveMs: Number(parsed.accumulatedActiveMs) || 0,
        };
      }
    } catch {
      // ignore
    }
  }

  function saveQueuesToStorage() {
    try {
      localStorage.setItem(STORAGE_QUEUE_KEY, JSON.stringify(state.sendQueue));
      localStorage.setItem(STORAGE_FAILED_KEY, JSON.stringify(state.failedQueue));
    } catch {
      // ignore
    }
  }

  function loadQueuesFromStorage() {
    try {
      const q = localStorage.getItem(STORAGE_QUEUE_KEY);
      const f = localStorage.getItem(STORAGE_FAILED_KEY);
      state.sendQueue = q ? JSON.parse(q) : [];
      state.failedQueue = f ? JSON.parse(f) : [];
      if (!Array.isArray(state.sendQueue)) state.sendQueue = [];
      if (!Array.isArray(state.failedQueue)) state.failedQueue = [];
    } catch {
      state.sendQueue = [];
      state.failedQueue = [];
    }
  }

  function renderTimer() {
    const t = state.timer;
    const isIdle = t.status === 'idle';
    const isRunning = t.status === 'running';
    const isPaused = t.status === 'paused';

    el.colorBtns.forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.color === t.color);
      btn.disabled = !isIdle;
    });

    el.productBtns.forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.product === t.product);
      btn.disabled = !isIdle;
    });

    el.timerBox.classList.toggle('state-idle', isIdle);
    el.timerBox.classList.toggle('state-running', isRunning);
    el.timerBox.classList.toggle('state-paused', isPaused);

    if (isIdle) {
      el.timerStatusBadge.textContent = '待機中';
    } else if (isRunning) {
      el.timerStatusBadge.textContent = '計測中';
    } else {
      el.timerStatusBadge.textContent = '一時停止中';
    }

    if (t.color && t.product) {
      el.timerSelectionSummary.textContent = `${t.color} / ${t.product}`;
    } else {
      el.timerSelectionSummary.textContent = 'COLOR・製品を選択してください';
    }

    el.timerValue.textContent = formatMmSs(getActiveMs() / 1000);

    el.idleControls.classList.toggle('hidden', !isIdle);
    el.activeControls.classList.toggle('hidden', isIdle);

    el.startBtn.disabled = !isIdle || !t.color || !t.product;
    el.pauseResumeBtn.textContent = isPaused ? '再開' : '一時停止';
  }

  function startTicker() {
    stopTicker();
    state.tickHandle = setInterval(() => {
      el.timerValue.textContent = formatMmSs(getActiveMs() / 1000);
    }, 250);
  }

  function stopTicker() {
    if (state.tickHandle) {
      clearInterval(state.tickHandle);
      state.tickHandle = null;
    }
  }

  function resetTimerKeepSelection() {
    stopTicker();
    state.timer.status = 'idle';
    state.timer.startTimeIso = null;
    state.timer.lastResumedAtMs = null;
    state.timer.accumulatedActiveMs = 0;
    saveTimerToStorage();
    renderTimer();
  }

  function renderSyncAndRetryUI() {
    const queueCount = state.sendQueue.length;
    if (queueCount > 0 || state.isProcessingQueue) {
      el.syncStatusPill.textContent = `同期中 (${Math.max(1, queueCount)}件)...`;
      el.syncStatusPill.classList.remove('hidden');
    } else {
      el.syncStatusPill.classList.add('hidden');
    }

    if (state.failedQueue.length === 0) {
      el.retryBanner.classList.add('hidden');
      return;
    }
    const lastErr = state.failedQueue[0]?.errorMessage || '通信に失敗しました。';
    el.retryErrorText.textContent = `未送信データ ${state.failedQueue.length}件: ${lastErr}`;
    el.retryBanner.classList.remove('hidden');
    el.retrySendBtn.disabled = state.isProcessingQueue;
    el.discardPendingBtn.disabled = state.isProcessingQueue;
  }

  function getMergedDisplayData() {
    const base = state.todayData || {
      dateString: '',
      records: [],
      stats: {
        totalSeconds: 0,
        totalCount: 0,
        throughCount: 0,
        matrix: {},
      },
    };

    const pendingCreates = [...state.sendQueue, ...state.failedQueue]
      .filter((item) => item.optimisticRecord)
      .map((item) => ({ ...item.optimisticRecord, _pending: true }));

    if (pendingCreates.length === 0) {
      return base;
    }

    const mergedRecords = [...pendingCreates.reverse(), ...(base.records || [])];

    let totalSeconds = 0;
    let throughCount = 0;
    const matrix = {};
    for (const c of COLORS) {
      matrix[c] = {};
      for (const p of PRODUCTS) {
        matrix[c][p] = { count: 0, throughCount: 0, totalSeconds: 0, avgSeconds: null };
      }
    }

    for (const rec of mergedRecords) {
      const sec = Math.max(0, Number(rec.durationSec) || 0);
      const isThrough = rec.judgement === 'スルー';
      totalSeconds += sec;
      if (isThrough) throughCount += 1;
      const cell = matrix[rec.color]?.[rec.product];
      if (cell) {
        cell.count += 1;
        cell.totalSeconds += sec;
        if (isThrough) cell.throughCount += 1;
      }
    }

    for (const c of COLORS) {
      for (const p of PRODUCTS) {
        const cell = matrix[c][p];
        if (cell.count > 0) {
          cell.avgSeconds = Math.round(cell.totalSeconds / cell.count);
        }
      }
    }

    return {
      dateString: base.dateString,
      records: mergedRecords,
      stats: {
        totalSeconds,
        totalCount: mergedRecords.length,
        throughCount,
        matrix,
      },
    };
  }

  function renderDashboardAndHistory() {
    const data = getMergedDisplayData();
    if (data.dateString) {
      el.todayDateLabel.textContent = data.dateString;
    }

    const stats = data.stats;
    el.kpiTotalTime.textContent = formatHmsJapanese(stats.totalSeconds);
    el.kpiTotalCount.textContent = String(stats.totalCount);
    el.kpiThroughSub.textContent = `うちスルー ${stats.throughCount}個`;

    el.matrixBody.innerHTML = '';
    for (const color of COLORS) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = color;
      tr.appendChild(th);

      for (const product of PRODUCTS) {
        const td = document.createElement('td');
        const cell = stats.matrix?.[color]?.[product];
        if (!cell || cell.count === 0) {
          td.innerHTML = '<div class="matrix-avg">-</div><div class="matrix-count">0個</div>';
        } else {
          const avgStr = formatMmSs(cell.avgSeconds);
          const throughNote = cell.throughCount > 0 ? ` (スルー${cell.throughCount})` : '';
          td.innerHTML = `<div class="matrix-avg">${avgStr}</div><div class="matrix-count">${cell.count}個${throughNote}</div>`;
        }
        tr.appendChild(td);
      }
      el.matrixBody.appendChild(tr);
    }

    const records = data.records || [];
    el.historyList.innerHTML = '';
    el.historyEmpty.classList.toggle('hidden', records.length > 0);

    for (const rec of records) {
      const item = document.createElement('div');
      item.className = 'history-item';

      const main = document.createElement('div');
      main.className = 'history-main';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'history-time';
      timeSpan.textContent = `${rec.startTime}〜${rec.endTime}`;

      const tagSpan = document.createElement('span');
      tagSpan.className = 'history-tag';
      tagSpan.textContent = `${rec.color} / ${rec.product}`;

      const durSpan = document.createElement('span');
      durSpan.className = 'history-duration';
      durSpan.textContent = `${rec.durationSec}秒 (${formatMmSs(rec.durationSec)})`;

      const judgeSpan = document.createElement('span');
      const isThrough = rec.judgement === 'スルー';
      judgeSpan.className = isThrough ? 'badge-through' : 'badge-normal';
      judgeSpan.textContent = rec.judgement;

      main.append(timeSpan, tagSpan, durSpan, judgeSpan);

      if (rec._pending) {
        const pendSpan = document.createElement('span');
        pendSpan.className = 'badge-pending';
        pendSpan.textContent = '送信待ち';
        main.appendChild(pendSpan);
      }

      if (rec.memo) {
        const memoSpan = document.createElement('span');
        memoSpan.className = 'history-memo';
        memoSpan.textContent = `メモ: ${rec.memo}`;
        main.appendChild(memoSpan);
      }

      const actions = document.createElement('div');
      actions.className = 'history-actions';

      if (!rec._pending) {
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn btn-ghost btn-sm';
        editBtn.textContent = '編集';
        editBtn.addEventListener('click', () => openEditModal(rec));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-danger btn-sm';
        delBtn.textContent = '削除';
        delBtn.addEventListener('click', () => openDeleteModal(rec));

        actions.append(editBtn, delBtn);
      }

      item.append(main, actions);
      el.historyList.appendChild(item);
    }
  }

  /**
   * GAS Web App への POST リクエスト（CORSプリフライト回避のため text/plain を使用）
   */
  async function gasRequest(action, payload = {}) {
    const gasUrl = getGasUrl();
    const token = getToken();
    if (!gasUrl || !token) {
      const err = new Error('GAS URL または合言葉（PIN）が未設定です。');
      err.code = 'CLIENT_NOT_CONFIGURED';
      throw err;
    }

    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, ...payload }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.code = data.code || 'API_ERROR';
      throw err;
    }
    return data;
  }

  async function refreshTodayData() {
    const gasUrl = getGasUrl();
    const token = getToken();
    if (!gasUrl || !token) {
      el.todayDateLabel.textContent = '未認証';
      openAuthModal('', false);
      return false;
    }

    try {
      el.configBanner.classList.add('hidden');
      const data = await gasRequest('getToday');
      state.todayData = data;
      renderDashboardAndHistory();
      return true;
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') {
        el.todayDateLabel.textContent = '認証エラー';
        openAuthModal(err.message, false);
        return false;
      }
      el.configBannerText.textContent = err.message;
      el.configBanner.classList.remove('hidden');
      return false;
    }
  }

  async function processSendQueue() {
    if (state.isProcessingQueue) return;
    state.isProcessingQueue = true;
    renderSyncAndRetryUI();

    try {
      while (state.sendQueue.length > 0) {
        const job = state.sendQueue[0];
        try {
          const data = await gasRequest(job.action, job.payload);
          state.sendQueue.shift();
          state.todayData = data;
          saveQueuesToStorage();
          renderDashboardAndHistory();
          renderSyncAndRetryUI();
        } catch (err) {
          state.sendQueue.shift();
          state.failedQueue.push({
            ...job,
            errorMessage: err.message,
          });
          saveQueuesToStorage();
          renderDashboardAndHistory();
          renderSyncAndRetryUI();
          if (err.code === 'UNAUTHORIZED') {
            openAuthModal(err.message, true);
          } else {
            showToast('送信に失敗しました。再送信してください');
          }
        }
      }
    } finally {
      state.isProcessingQueue = false;
      renderSyncAndRetryUI();
    }
  }

  function enqueueJob(job) {
    state.sendQueue.push(job);
    saveQueuesToStorage();
    renderDashboardAndHistory();
    renderSyncAndRetryUI();
    processSendQueue();
  }

  // Auth / Settings Modal Handlers
  el.authSettingsBtn.addEventListener('click', () => {
    openAuthModal('', true);
  });

  el.closeAuthModalBtn.addEventListener('click', closeAuthModal);

  el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const gasUrl = el.authGasUrl.value.trim();
    const token = el.authTokenInput.value.trim();
    if (!gasUrl || !token) return;

    el.saveAuthBtn.disabled = true;
    el.saveAuthBtn.textContent = '確認中...';
    el.authErrorMsg.classList.add('hidden');

    const prevUrl = getGasUrl();
    const prevToken = getToken();
    saveAuth(gasUrl, token);

    const ok = await refreshTodayData();
    el.saveAuthBtn.disabled = false;
    el.saveAuthBtn.textContent = '接続して開始';

    if (ok) {
      closeAuthModal();
      showToast('認証に成功しました');
      if (state.sendQueue.length > 0) {
        processSendQueue();
      }
    } else {
      // Revert if failed
      if (prevUrl) localStorage.setItem(STORAGE_GAS_URL_KEY, prevUrl);
      if (prevToken) localStorage.setItem(STORAGE_TOKEN_KEY, prevToken);
    }
  });

  // Timer Event Handlers
  el.colorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.timer.status !== 'idle') return;
      state.timer.color = btn.dataset.color;
      saveTimerToStorage();
      renderTimer();
    });
  });

  el.productBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state.timer.status !== 'idle') return;
      state.timer.product = btn.dataset.product;
      saveTimerToStorage();
      renderTimer();
    });
  });

  el.startBtn.addEventListener('click', () => {
    if (!state.timer.color || !state.timer.product || state.timer.status !== 'idle') {
      return;
    }
    const nowMs = Date.now();
    state.timer.status = 'running';
    state.timer.startTimeIso = new Date(nowMs).toISOString();
    state.timer.lastResumedAtMs = nowMs;
    state.timer.accumulatedActiveMs = 0;
    saveTimerToStorage();
    renderTimer();
    startTicker();
  });

  el.pauseResumeBtn.addEventListener('click', () => {
    if (state.timer.status === 'running') {
      state.timer.accumulatedActiveMs = getActiveMs();
      state.timer.lastResumedAtMs = null;
      state.timer.status = 'paused';
      stopTicker();
    } else if (state.timer.status === 'paused') {
      state.timer.lastResumedAtMs = Date.now();
      state.timer.status = 'running';
      startTicker();
    }
    saveTimerToStorage();
    renderTimer();
  });

  function handleComplete(isThrough) {
    if (state.timer.status === 'idle') return;
    const endDate = new Date();
    const startDate = state.timer.startTimeIso
      ? new Date(state.timer.startTimeIso)
      : endDate;
    const durationSec = Math.max(0, Math.floor(getActiveMs() / 1000));

    const payload = {
      color: state.timer.color,
      product: state.timer.product,
      startTime: formatTimeHms(startDate),
      endTime: formatTimeHms(endDate),
      durationSec,
      isThrough,
    };

    resetTimerKeepSelection();

    showToast(
      isThrough
        ? `スルー良品を記録 (${durationSec}秒)`
        : `完了（磨き）を記録 (${durationSec}秒)`
    );

    enqueueJob({
      action: 'createRecord',
      payload,
      optimisticRecord: {
        startTime: payload.startTime,
        endTime: payload.endTime,
        durationSec: payload.durationSec,
        color: payload.color,
        product: payload.product,
        judgement: isThrough ? 'スルー' : '通常',
        memo: '',
      },
    });
  }

  el.completeNormalBtn.addEventListener('click', () => handleComplete(false));
  el.completeThroughBtn.addEventListener('click', () => handleComplete(true));

  el.retrySendBtn.addEventListener('click', () => {
    if (state.failedQueue.length === 0 || state.isProcessingQueue) return;
    const toRetry = state.failedQueue.splice(0, state.failedQueue.length);
    state.sendQueue.push(...toRetry);
    saveQueuesToStorage();
    renderSyncAndRetryUI();
    processSendQueue();
  });

  el.discardPendingBtn.addEventListener('click', () => {
    state.failedQueue = [];
    saveQueuesToStorage();
    renderDashboardAndHistory();
    renderSyncAndRetryUI();
  });

  el.refreshBtn.addEventListener('click', refreshTodayData);

  // Record Modal helpers
  function syncModalChoiceUI() {
    document.querySelectorAll('[data-modal-color]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.modalColor === state.modalSelection.color);
    });
    document.querySelectorAll('[data-modal-product]').forEach((b) => {
      b.classList.toggle('selected', b.dataset.modalProduct === state.modalSelection.product);
    });
    document.querySelectorAll('[data-modal-through]').forEach((b) => {
      b.classList.toggle(
        'selected',
        String(state.modalSelection.isThrough) === b.dataset.modalThrough
      );
    });
  }

  document.querySelectorAll('[data-modal-color]').forEach((b) => {
    b.addEventListener('click', () => {
      state.modalSelection.color = b.dataset.modalColor;
      syncModalChoiceUI();
    });
  });

  document.querySelectorAll('[data-modal-product]').forEach((b) => {
    b.addEventListener('click', () => {
      state.modalSelection.product = b.dataset.modalProduct;
      syncModalChoiceUI();
    });
  });

  document.querySelectorAll('[data-modal-through]').forEach((b) => {
    b.addEventListener('click', () => {
      state.modalSelection.isThrough = b.dataset.modalThrough === 'true';
      syncModalChoiceUI();
    });
  });

  function openEditModal(rec) {
    el.recordModalTitle.textContent = '記録の編集';
    el.modalMode.value = 'edit';
    el.modalRecordId.value = rec.id;
    state.modalSelection = {
      color: rec.color,
      product: rec.product,
      isThrough: rec.judgement === 'スルー',
    };
    el.modalDurationSec.value = String(rec.durationSec);
    el.modalMemo.value = rec.memo || '';
    syncModalChoiceUI();
    el.recordModal.classList.remove('hidden');
  }

  function openManualAddModal() {
    el.recordModalTitle.textContent = '手動で1件追加';
    el.modalMode.value = 'manual';
    el.modalRecordId.value = '';
    state.modalSelection = {
      color: state.timer.color || '1F7',
      product: state.timer.product || 'RH',
      isThrough: false,
    };
    el.modalDurationSec.value = '60';
    el.modalMemo.value = '押し忘れ追加';
    syncModalChoiceUI();
    el.recordModal.classList.remove('hidden');
  }

  function closeRecordModal() {
    el.recordModal.classList.add('hidden');
  }

  el.manualAddBtn.addEventListener('click', openManualAddModal);
  el.closeRecordModalBtn.addEventListener('click', closeRecordModal);
  el.cancelRecordModalBtn.addEventListener('click', closeRecordModal);

  el.recordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const mode = el.modalMode.value;
    const payload = {
      color: state.modalSelection.color,
      product: state.modalSelection.product,
      durationSec: Math.max(0, Math.round(Number(el.modalDurationSec.value) || 0)),
      isThrough: state.modalSelection.isThrough,
      memo: el.modalMemo.value.trim(),
    };

    closeRecordModal();

    if (mode === 'manual') {
      const nowTime = formatTimeHms(new Date());
      showToast('手動追加を送信しています...');
      enqueueJob({
        action: 'createManualRecord',
        payload,
        optimisticRecord: {
          startTime: nowTime,
          endTime: nowTime,
          durationSec: payload.durationSec,
          color: payload.color,
          product: payload.product,
          judgement: payload.isThrough ? 'スルー' : '通常',
          memo: payload.memo || '手動追加',
        },
      });
    } else {
      const id = el.modalRecordId.value;
      showToast('修正を送信しています...');
      enqueueJob({
        action: 'updateRecord',
        payload: { id, ...payload },
      });
    }
  });

  function openDeleteModal(rec) {
    el.deleteRecordId.value = rec.id;
    el.deleteTargetSummary.textContent = `${rec.startTime}〜${rec.endTime} / ${rec.color} / ${rec.product} / ${rec.durationSec}秒 (${rec.judgement})`;
    el.deleteMemo.value = '';
    el.deleteModal.classList.remove('hidden');
  }

  function closeDeleteModal() {
    el.deleteModal.classList.add('hidden');
  }

  el.closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
  el.cancelDeleteModalBtn.addEventListener('click', closeDeleteModal);

  el.deleteForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = el.deleteRecordId.value;
    const memo = el.deleteMemo.value.trim();
    closeDeleteModal();
    showToast('削除を送信しています...');
    enqueueJob({
      action: 'deleteRecord',
      payload: { id, memo },
    });
  });

  // Init
  loadTimerFromStorage();
  loadQueuesFromStorage();
  renderTimer();
  renderDashboardAndHistory();
  renderSyncAndRetryUI();
  if (state.timer.status === 'running') {
    startTicker();
  }
  refreshTodayData().then((ok) => {
    if (ok && state.sendQueue.length > 0) {
      processSendQueue();
    }
  });
})();
