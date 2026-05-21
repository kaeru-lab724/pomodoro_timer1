// タイマー状態の定義
const STATES = {
    IDLE: 'idle',
    WORK: 'work',
    SHORT_BREAK: 'short_break',
    LONG_BREAK: 'long_break'
};

// タイマーの状態管理オブジェクト
let timerState = {
    status: STATES.IDLE,
    isRunning: false,
    workTime: 25 * 60, // 秒
    shortBreak: 5 * 60, // 秒
    longBreak: 15 * 60, // 秒
    longBreakInterval: 0, // 何セットに1回か
    totalSets: 3, // 目標セット数
    totalExpectedTime: 0, // 総予定時間（秒）
    showConfirm: true, // 確認ダイアログの表示有無
    playSound: true, // 通知音再生の有無
    theme: 'classic', // カラーテーマ
    
    currentSet: 1,
    timeLeft: 25 * 60, // 現在のフェーズの残り時間（秒）
    totalDuration: 25 * 60, // 現在のフェーズの総時間（秒）
    intervalId: null
};

// オーディオコンテキストの管理
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// DOM要素の参照
const configCard = document.getElementById('config-card');
const timerContainer = document.getElementById('timer-container');

// 設定入力要素
const inputWork = document.getElementById('work-time');
const inputShort = document.getElementById('short-break');
const inputLong = document.getElementById('long-break');
const inputInterval = document.getElementById('long-break-interval');
const inputTotalSets = document.getElementById('total-sets');
const inputShowConfirm = document.getElementById('show-confirm');
const inputPlaySound = document.getElementById('play-sound');
const inputTheme = document.getElementById('theme-select');

// 表示要素
const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const timeDisplay = document.getElementById('time-display');
const progressBar = document.getElementById('progress-bar');
const currentSetNum = document.getElementById('current-set-num');
const setsDotsContainer = document.getElementById('sets-dots-container');
const overallProgressBar = document.getElementById('overall-progress-bar');
const overallProgressText = document.getElementById('overall-progress-text');
const overallProgressRingBar = document.getElementById('overall-progress-ring-bar');
const overallTimeSubtext = document.getElementById('overall-time-subtext');

// 操作ボタン
const startBtn = document.getElementById('start-btn');
const controlPauseBtn = document.getElementById('control-pause-btn');
const controlRestartBtn = document.getElementById('control-restart-btn');
const controlSkipBtn = document.getElementById('control-skip-btn');
const controlResetBtn = document.getElementById('control-reset-btn');
const pipBtn = document.getElementById('pip-btn');
const pauseIcon = controlPauseBtn.querySelector('.pause-icon');
const playIcon = controlPauseBtn.querySelector('.play-icon');

// PiPウィンドウの参照
let pipWindow = null;
let fallbackPopup = null;

// プログレスバーの円周 (2 * PI * r)
const BAR_CIRCUMFERENCE = 2 * Math.PI * 88; // r = 88 => 552.92
progressBar.style.strokeDasharray = BAR_CIRCUMFERENCE;
progressBar.style.strokeDashoffset = 0;

const OVERALL_CIRCUMFERENCE = 2 * Math.PI * 76; // r = 76 => 477.52
overallProgressRingBar.style.strokeDasharray = OVERALL_CIRCUMFERENCE;
overallProgressRingBar.style.strokeDashoffset = OVERALL_CIRCUMFERENCE;

// --- カラーテーマ初期化・イベント ---
const savedTheme = localStorage.getItem('pomodoro_theme') || 'classic';
timerState.theme = savedTheme;
if (inputTheme) {
    inputTheme.value = savedTheme;
    inputTheme.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        timerState.theme = newTheme;
        localStorage.setItem('pomodoro_theme', newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
    });
}
document.documentElement.setAttribute('data-theme', savedTheme);

// イベントリスナーの設定
startBtn.addEventListener('click', startTimerFlow);
controlPauseBtn.addEventListener('click', togglePause);
controlRestartBtn.addEventListener('click', restartCurrentSession);
controlSkipBtn.addEventListener('click', skipSession);
controlResetBtn.addEventListener('click', resetTimerFlow);
pipBtn.addEventListener('click', toggleMiniWindow);

// デフォルトでPiPボタンのサポート状況を確認し、テキストを最適化
if (!('documentPictureInPicture' in window)) {
    pipBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><path d="M7 2h10"></path><rect x="14" y="14" width="8" height="8" rx="1" ry="1"></rect></svg>
        別ウィンドウで開く (ミニ表示)
    `;
}

// ユーザーがウィンドウを閉じる際、PiPも確実に閉じる
window.addEventListener('beforeunload', () => {
    closeMiniWindow();
});

/**
 * タイマー開始（設定からタイマー画面へ）
 */
function startTimerFlow() {
    // オーディオ初期化（自動再生制限の解除用）
    initAudio();

    // 設定値の読み込みとバリデーション
    const workVal = Math.max(1, parseInt(inputWork.value) || 25);
    const shortVal = Math.max(1, parseInt(inputShort.value) || 5);
    const longVal = Math.max(1, parseInt(inputLong.value) || 15);
    const intervalVal = Math.max(0, parseInt(inputInterval.value));
    const totalSetsVal = Math.max(1, parseInt(inputTotalSets.value) || 4);

    timerState.workTime = workVal * 60;
    timerState.shortBreak = shortVal * 60;
    timerState.longBreak = longVal * 60;
    timerState.longBreakInterval = intervalVal;
    timerState.totalSets = totalSetsVal;
    timerState.showConfirm = inputShowConfirm.checked;
    timerState.playSound = inputPlaySound.checked;
    
    // 総予定時間の計算
    const workTotal = timerState.workTime * timerState.totalSets;
    const breakTotal = timerState.shortBreak * timerState.totalSets;
    const longBreakTotal = (timerState.longBreakInterval > 0) ? timerState.longBreak : 0;
    timerState.totalExpectedTime = workTotal + breakTotal + longBreakTotal;
    
    timerState.currentSet = 1;
    
    // 表示の初期設定
    configCard.classList.add('hidden');
    timerContainer.classList.remove('hidden');
    
    // 最初のセッション（ワークタイム）をセットアップ
    setupSession(STATES.WORK);
    startCountdown();
}

/**
 * カラープライマリ変数を適用する（PiPやポップアップも同期）
 */
function setPrimaryColor(colorVar, colorRgbVar) {
    const apply = (docEl) => {
        if (!docEl) return;
        docEl.style.setProperty('--color-primary', colorVar);
        docEl.style.setProperty('--color-primary-rgb', colorRgbVar);
    };
    
    // メインウィンドウのhtmlとタイマーコンテナ
    apply(document.documentElement);
    apply(timerContainer);
    
    // PiPウィンドウがあれば同期
    if (pipWindow && pipWindow.document) {
        apply(pipWindow.document.documentElement);
    }
    
    // フォールバックポップアップがあれば同期
    if (fallbackPopup && fallbackPopup.document) {
        apply(fallbackPopup.document.documentElement);
    }
}

/**
 * セッション（Work / Short Break / Long Break）のセットアップ
 */
function setupSession(state) {
    timerState.status = state;
    
    if (state === STATES.WORK) {
        timerState.timeLeft = timerState.workTime;
        timerState.totalDuration = timerState.workTime;
        
        statusBadge.className = 'badge work';
        statusBadge.textContent = 'WORK TIME';
        statusText.textContent = 'WORK TIME';
        setPrimaryColor('var(--color-work)', 'var(--color-work-rgb)');
    } else if (state === STATES.SHORT_BREAK) {
        timerState.timeLeft = timerState.shortBreak;
        timerState.totalDuration = timerState.shortBreak;
        
        statusBadge.className = 'badge short';
        statusBadge.textContent = 'THINKING';
        statusText.textContent = 'THINKING';
        setPrimaryColor('var(--color-short)', 'var(--color-short-rgb)');
    } else if (state === STATES.LONG_BREAK) {
        timerState.timeLeft = timerState.longBreak;
        timerState.totalDuration = timerState.longBreak;
        
        statusBadge.className = 'badge long';
        statusBadge.textContent = 'LONG BREAK';
        statusText.textContent = 'LONG BREAK';
        setPrimaryColor('var(--color-long)', 'var(--color-long-rgb)');
    }
    
    currentSetNum.textContent = timerState.currentSet;
    updateProgress();
    updateDisplay();
    renderDots();
}

/**
 * 進行度インジケーター（ドット）のレンダリング
 */
function renderDots() {
    setsDotsContainer.innerHTML = '';
    const dotsCount = timerState.totalSets;
    
    for (let i = 1; i <= dotsCount; i++) {
        const dot = document.createElement('div');
        dot.className = 'dot';
        
        if (i < timerState.currentSet) {
            dot.classList.add('completed');
        } else if (i === timerState.currentSet) {
            if (timerState.status === STATES.WORK) {
                dot.classList.add('active');
            } else if (timerState.status === STATES.SHORT_BREAK || timerState.status === STATES.LONG_BREAK) {
                dot.classList.add('completed');
            }
        }
        setsDotsContainer.appendChild(dot);
    }
}

/**
 * カウントダウンの開始
 */
function startCountdown() {
    if (timerState.intervalId) clearInterval(timerState.intervalId);
    
    timerState.isRunning = true;
    updateControlButtons();
    
    timerState.intervalId = setInterval(() => {
        if (timerState.timeLeft > 0) {
            timerState.timeLeft--;
            updateDisplay();
            updateProgress();
        } else {
            // セッション終了
            handleSessionEnd();
        }
    }, 1000);
}

/**
 * タイマーの一時停止/再開
 */
function togglePause() {
    if (timerState.isRunning) {
        // 一時停止
        clearInterval(timerState.intervalId);
        timerState.intervalId = null;
        timerState.isRunning = false;
        statusText.textContent = 'PAUSED';
    } else {
        // 再開
        if (timerState.status === STATES.WORK) {
            statusText.textContent = 'WORK TIME';
        } else if (timerState.status === STATES.SHORT_BREAK) {
            statusText.textContent = 'THINKING';
        } else if (timerState.status === STATES.LONG_BREAK) {
            statusText.textContent = 'LONG BREAK';
        }
        startCountdown();
    }
    updateControlButtons();
}

/**
 * コントロールボタンの表示更新
 */
function updateControlButtons() {
    if (timerState.isRunning) {
        pauseIcon.classList.remove('hidden');
        playIcon.classList.add('hidden');
    } else {
        pauseIcon.classList.add('hidden');
        playIcon.classList.remove('hidden');
    }
}

/**
 * 現在のセッションを最初に戻す
 */
function restartCurrentSession() {
    const isMini = !!(pipWindow || fallbackPopup);
    const needConfirm = timerState.showConfirm && !isMini;
    if (!needConfirm || confirm("現在のセッションを最初からやり直しますか？")) {
        timerState.timeLeft = timerState.totalDuration;
        updateDisplay();
        updateProgress();
    }
}

/**
 * セッションをスキップ
 */
function skipSession() {
    const isMini = !!(pipWindow || fallbackPopup);
    const needConfirm = timerState.showConfirm && !isMini;
    if (!needConfirm || confirm("現在のセッションをスキップして次に進みますか？")) {
        handleSessionEnd(true);
    }
}

/**
 * リセット（設定画面に戻る）
 */
function resetTimerFlow() {
    const isMini = !!(pipWindow || fallbackPopup);
    const needConfirm = timerState.showConfirm && !isMini;
    if (!needConfirm || confirm("タイマーをリセットして設定に戻りますか？")) {
        if (timerState.intervalId) clearInterval(timerState.intervalId);
        timerState.intervalId = null;
        timerState.isRunning = false;
        timerState.status = STATES.IDLE;
        
        // ボタンの無効化を解除
        controlPauseBtn.disabled = false;
        controlSkipBtn.disabled = false;
        controlRestartBtn.disabled = false;
        
        // ミニウィンドウが開いていたら閉じる
        closeMiniWindow();
        
        // 画面切り替え
        timerContainer.classList.add('hidden');
        configCard.classList.remove('hidden');
        
        // リセット
        timeDisplay.textContent = `${inputWork.value.padStart(2, '0')}:00`;
        progressBar.style.strokeDashoffset = 0;
        overallProgressRingBar.style.strokeDashoffset = OVERALL_CIRCUMFERENCE;
        overallTimeSubtext.textContent = '0% | Left 00:00';
        overallProgressBar.style.width = '0%';
        overallProgressText.textContent = '0%';
    }
}

/**
 * セッション終了時の処理
 */
function handleSessionEnd(skipped = false) {
    if (timerState.intervalId) clearInterval(timerState.intervalId);
    timerState.intervalId = null;
    timerState.isRunning = false;
    
    const oldStatus = timerState.status;
    let nextStatus = null;
    let isAllCompleted = false;
    
    // 状態遷移の判定
    if (oldStatus === STATES.WORK) {
        // WORK終了後は必ずSHORT_BREAK（シンキングタイム）へ
        nextStatus = STATES.SHORT_BREAK;
    } else if (oldStatus === STATES.SHORT_BREAK) {
        // SHORT_BREAK終了時
        if (timerState.currentSet >= timerState.totalSets) {
            // 目標セット数をすべて完了した場合
            if (timerState.longBreakInterval > 0) {
                // ロングブレイクが有効ならロングブレイクへ
                nextStatus = STATES.LONG_BREAK;
            } else {
                // ロングブレイクが無効ならここで完了
                isAllCompleted = true;
            }
        } else {
            // まだ目標セット数に達していないなら、セットをインクリメントしてWORKへ
            nextStatus = STATES.WORK;
        }
    } else if (oldStatus === STATES.LONG_BREAK) {
        // ロングブレイク終了後はすべて完了
        isAllCompleted = true;
    }
    
    // 通知音と通知の制御（スキップ時以外）
    if (!skipped) {
        if (isAllCompleted) {
            playCompletionSound();
        } else {
            playNotificationSound(oldStatus === STATES.WORK ? 'work-end' : 'break-end');
            triggerDesktopNotification(nextStatus);
        }
    }
    
    // 遷移の実行
    if (isAllCompleted) {
        handleAllSetsCompleted(skipped);
    } else {
        if (oldStatus === STATES.SHORT_BREAK && nextStatus === STATES.WORK) {
            timerState.currentSet++;
        }
        setupSession(nextStatus);
        startCountdown();
    }
}

/**
 * すべての目標セットが完了したときの処理
 */
function handleAllSetsCompleted(skipped = false) {
    timerState.status = STATES.IDLE;
    timerState.isRunning = false;
    
    // 特別な完了サウンド（ファンファーレ風）を鳴らす
    if (!skipped) {
        playCompletionSound();
    }
    
    // 表示の更新
    statusBadge.className = 'badge work';
    statusBadge.textContent = 'Completed';
    statusText.textContent = 'すべてのセットが完了しました！';
    setPrimaryColor('var(--color-long)', 'var(--color-long-rgb)');
    
    // 進捗を100%にする
    progressBar.style.strokeDashoffset = 0;
    overallProgressRingBar.style.strokeDashoffset = 0;
    timeDisplay.textContent = 'Done!';
    overallTimeSubtext.textContent = '100% | Completed';
    
    overallProgressBar.style.width = `100%`;
    overallProgressText.textContent = `100% (完了)`;
    
    // デスクトップ通知
    if (!skipped && "Notification" in window && Notification.permission === "granted") {
        new Notification("おめでとうございます！", { body: "設定されたすべてのポモドーロセッションが完了しました。" });
    }
    
    // 一時停止とスキップボタンを無効化する
    controlPauseBtn.disabled = true;
    controlSkipBtn.disabled = true;
    controlRestartBtn.disabled = true;
}

/**
 * すべて完了したときのお祝いのメロディを生成
 */
function playCompletionSound() {
    if (!timerState.playSound) return;
    try {
        initAudio();
        if (!audioCtx) return;
        
        const playTone = (freq, start, duration, type = 'sine') => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.type = type;
            osc.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
            
            gain.gain.setValueAtTime(0, audioCtx.currentTime + start);
            gain.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + start + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + start + duration);
            
            osc.start(audioCtx.currentTime + start);
            osc.stop(audioCtx.currentTime + start + duration);
        };
        
        // ド・ミ・ソ・ドの明るいチャイム
        playTone(523.25, 0, 0.3);    // C5
        playTone(659.25, 0.15, 0.3);  // E5
        playTone(783.99, 0.3, 0.3);   // G5
        playTone(1046.50, 0.45, 0.8, 'triangle'); // C6
    } catch (e) {
        console.warn('完了オーディオ再生に失敗しました:', e);
    }
}

/**
 * ディスプレイ（文字）の更新
 */
function updateDisplay() {
    const minutes = Math.floor(timerState.timeLeft / 60);
    const seconds = timerState.timeLeft % 60;
    const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    timeDisplay.textContent = timeStr;
    
    // ブラウザのタブタイトルも更新する
    const statusEmoji = timerState.status === STATES.WORK ? '🔴' : '🟢';
    let stateName = 'WORK';
    if (timerState.status === STATES.SHORT_BREAK) {
        stateName = 'THINKING';
    } else if (timerState.status === STATES.LONG_BREAK) {
        stateName = 'LONG BREAK';
    }
    document.title = `${statusEmoji} ${timeStr} | ${stateName}`;

    // PiPやポップアップがある場合、その中のタイトルも同期
    if (pipWindow) {
        pipWindow.document.title = `${statusEmoji} ${timeStr} | ${stateName}`;
    }
    if (fallbackPopup) {
        fallbackPopup.document.title = `${statusEmoji} ${timeStr} | ${stateName}`;
    }
}

/**
 * 円形および全体プログレスバーの更新
 */
function updateProgress() {
    // 1. 現在のセッションの進捗（円形バー）
    const total = timerState.totalDuration;
    const left = timerState.timeLeft;
    
    // 進捗率（1.0 ~ 0.0）
    const progress = total > 0 ? left / total : 0;
    
    // dashoffsetを計算（100%の時は0、0%の時は円周分）
    const offset = BAR_CIRCUMFERENCE * (1 - progress);
    progressBar.style.strokeDashoffset = offset;

    // 2. 全体の進捗（水平バーおよび内側リング、サブテキスト）
    if (timerState.status !== STATES.IDLE) {
        const elapsedTime = getElapsedTime();
        const overallProgress = timerState.totalExpectedTime > 0 
            ? (elapsedTime / timerState.totalExpectedTime) 
            : 0;
        
        const percent = Math.min(100, Math.max(0, Math.round(overallProgress * 100)));
        overallProgressBar.style.width = `${percent}%`;
        
        // 全体の残り時間
        const remainingTotal = Math.max(0, timerState.totalExpectedTime - elapsedTime);
        const remainingMin = Math.floor(remainingTotal / 60);
        const remainingSec = remainingTotal % 60;
        const remainingStr = `${String(remainingMin).padStart(2, '0')}:${String(remainingSec).padStart(2, '0')}`;
        
        overallProgressText.textContent = `${percent}% (残り ${remainingStr})`;
        
        // 内側プログレスリングの更新
        const overallOffset = OVERALL_CIRCUMFERENCE * (1 - overallProgress);
        overallProgressRingBar.style.strokeDashoffset = overallOffset;
        
        // 中央サブテキストの更新
        overallTimeSubtext.textContent = `${percent}% | Left ${remainingStr}`;
    }
}

/**
 * これまでの総消化時間（秒）を計算
 */
function getElapsedTime() {
    let elapsed = 0;
    
    // 過去の完了したセット (1 から currentSet - 1 まで)
    for (let i = 1; i < timerState.currentSet; i++) {
        elapsed += timerState.workTime;
        elapsed += timerState.shortBreak;
    }
    
    // 現在のセットの経過時間
    if (timerState.status === STATES.WORK) {
        elapsed += (timerState.workTime - timerState.timeLeft);
    } else if (timerState.status === STATES.SHORT_BREAK) {
        // すでにワークは終わっているので足す
        elapsed += timerState.workTime;
        // 現在のブレイクの消化時間
        elapsed += (timerState.shortBreak - timerState.timeLeft);
    } else if (timerState.status === STATES.LONG_BREAK) {
        // すべてのワークとショートブレイクが終わっているので足す
        elapsed += timerState.workTime * timerState.totalSets;
        elapsed += timerState.shortBreak * timerState.totalSets;
        // ロングブレイクの消化時間
        elapsed += (timerState.longBreak - timerState.timeLeft);
    }
    
    return elapsed;
}

/**
 * Web Audio API を用いた通知音生成
 */
function playNotificationSound(type) {
    if (!timerState.playSound) return;
    try {
        initAudio();
        if (!audioCtx) return;
        
        if (type === 'work-end') {
            // 集中終了: 高く澄んだベルの音（C5 -> E5 -> G5）
            const playTone = (freq, start, duration) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
                
                gain.gain.setValueAtTime(0, audioCtx.currentTime + start);
                gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + start + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + start + duration);
                
                osc.start(audioCtx.currentTime + start);
                osc.stop(audioCtx.currentTime + start + duration);
            };
            
            playTone(523.25, 0, 0.4);   // C5
            playTone(659.25, 0.15, 0.4); // E5
            playTone(783.99, 0.3, 0.6);  // G5
        } else {
            // 休憩終了: 優しく落ち着いた音（A4 -> F4 -> C5）
            const playTone = (freq, start, duration) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.type = 'triangle'; // 少し柔らかい音色
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime + start);
                
                gain.gain.setValueAtTime(0, audioCtx.currentTime + start);
                gain.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + start + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + start + duration);
                
                osc.start(audioCtx.currentTime + start);
                osc.stop(audioCtx.currentTime + start + duration);
            };
            
            playTone(440.00, 0, 0.4);   // A4
            playTone(349.23, 0.15, 0.4); // F4
            playTone(523.25, 0.3, 0.6);  // C5
        }
    } catch (e) {
        console.warn('オーディオ再生に失敗しました:', e);
    }
}

/**
 * デスクトップ通知の送信
 */
function triggerDesktopNotification(nextStatus) {
    if (!("Notification" in window)) return;
    
    let sendText = '';
    let title = '';
    
    if (nextStatus === STATES.SHORT_BREAK) {
        sendText = 'シンキングタイム（THINKING）の時間です！';
        title = 'WORK TIME 終了！';
    } else if (nextStatus === STATES.LONG_BREAK) {
        sendText = 'ロングブレイク（LONG BREAK）の時間です！ゆっくり休んでください。';
        title = 'THINKING 終了！';
    } else if (nextStatus === STATES.WORK) {
        sendText = 'WORK TIME 開始！作業に戻りましょう。';
        title = '準備はいいですか？';
    } else {
        return;
    }

    if (Notification.permission === "granted") {
        new Notification(title, { body: sendText });
    } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification(title, { body: sendText });
            }
        });
    }
}

// デスクトップ通知の初期許可申請
if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
}

/**
 * ミニウィンドウ（PiP / ポップアップ）の切り替え
 */
async function toggleMiniWindow() {
    if (pipWindow || fallbackPopup) {
        closeMiniWindow();
        return;
    }
    
    if ('documentPictureInPicture' in window) {
        // Document PiP 対応ブラウザ
        await enterDocumentPiP();
    } else {
        // 非対応ブラウザ: window.open を使用したポップアップフォールバック
        enterFallbackPopup();
    }
}

/**
 * Document Picture-in-Picture モードの開始
 */
async function enterDocumentPiP() {
    try {
        pipWindow = await window.documentPictureInPicture.requestWindow({
            width: 310,
            height: 390,
        });
        
        // メインウィンドウのCSSスタイルシートをPiPウィンドウに流し込む
        [...document.styleSheets].forEach((styleSheet) => {
            try {
                const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
                const style = document.createElement('style');
                style.textContent = cssRules;
                pipWindow.document.head.appendChild(style);
            } catch (e) {
                // CORSポリシーにより外部CSS（Google Fontsなど）のルールに直接アクセスできない場合、linkとしてコピー
                if (styleSheet.href) {
                    const link = document.createElement('link');
                    link.rel = 'stylesheet';
                    link.href = styleSheet.href;
                    pipWindow.document.head.appendChild(link);
                }
            }
        });

        // 必要な外部フォントへの参照を追加
        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Plus+Jakarta+Sans:wght@400;500;700&display=swap';
        pipWindow.document.head.appendChild(fontLink);
        
        // PiPウィンドウのボディに専用スタイルクラスを付与
        pipWindow.document.body.classList.add('pip-body');
        pipWindow.document.body.setAttribute('data-theme', timerState.theme);
        
        // 現在のプライマリカラー変数をPiPのHTML要素にも適用
        let curPrimary = 'var(--color-work)';
        let curPrimaryRgb = 'var(--color-work-rgb)';
        if (timerState.status === STATES.SHORT_BREAK) {
            curPrimary = 'var(--color-short)';
            curPrimaryRgb = 'var(--color-short-rgb)';
        } else if (timerState.status === STATES.LONG_BREAK) {
            curPrimary = 'var(--color-long)';
            curPrimaryRgb = 'var(--color-long-rgb)';
        }
        pipWindow.document.documentElement.style.setProperty('--color-primary', curPrimary);
        pipWindow.document.documentElement.style.setProperty('--color-primary-rgb', curPrimaryRgb);
        
        // タイマーコンテナをPiPウィンドウのDOMに移譲
        pipWindow.document.body.appendChild(timerContainer);
        
        // タイトル設定
        updateDisplay();
        
        // PiPボタンの表示を変更（「元に戻す」など）
        pipBtn.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            メイン画面に戻す
        `;

        // PiPウィンドウが閉じられた時の復帰イベント
        pipWindow.addEventListener('pagehide', (event) => {
            pipWindow = null;
            returnContainerToMainWindow();
        });
        
    } catch (err) {
        console.error('Document PiPの開始に失敗しました:', err);
        // エラー時は通常のポップアップへフォールバック
        enterFallbackPopup();
    }
}

/**
 * window.open によるポップアップフォールバック
 */
function enterFallbackPopup() {
    const width = 320;
    const height = 410;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    
    // 空の新規ポップアップウィンドウを立ち上げる
    fallbackPopup = window.open(
        '',
        'PomodoroTimerPopup',
        `width=${width},height=${height},left=${left},top=${top},resizable=no,scrollbars=no`
    );
    
    if (!fallbackPopup) {
        alert("ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。");
        return;
    }
    
    // スタイルとフォントのコピー
    [...document.styleSheets].forEach((styleSheet) => {
        try {
            const cssRules = [...styleSheet.cssRules].map((rule) => rule.cssText).join('');
            const style = fallbackPopup.document.createElement('style');
            style.textContent = cssRules;
            fallbackPopup.document.head.appendChild(style);
        } catch (e) {
            if (styleSheet.href) {
                const link = fallbackPopup.document.createElement('link');
                link.rel = 'stylesheet';
                link.href = styleSheet.href;
                fallbackPopup.document.head.appendChild(link);
            }
        }
    });

    const fontLink = fallbackPopup.document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Plus+Jakarta+Sans:wght@400;500;700&display=swap';
    fallbackPopup.document.head.appendChild(fontLink);
    
    // DOM要素の移譲とクラス設定
    fallbackPopup.document.body.classList.add('pip-body');
    fallbackPopup.document.body.setAttribute('data-theme', timerState.theme);
    
    // 現在のプライマリカラー変数をポップアップのHTML要素にも適用
    let curPrimary = 'var(--color-work)';
    let curPrimaryRgb = 'var(--color-work-rgb)';
    if (timerState.status === STATES.SHORT_BREAK) {
        curPrimary = 'var(--color-short)';
        curPrimaryRgb = 'var(--color-short-rgb)';
    } else if (timerState.status === STATES.LONG_BREAK) {
        curPrimary = 'var(--color-long)';
        curPrimaryRgb = 'var(--color-long-rgb)';
    }
    fallbackPopup.document.documentElement.style.setProperty('--color-primary', curPrimary);
    fallbackPopup.document.documentElement.style.setProperty('--color-primary-rgb', curPrimaryRgb);
    
    fallbackPopup.document.body.appendChild(timerContainer);
    
    // タイトル設定
    updateDisplay();
    
    // ボタン表示の変更
    pipBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        メイン画面に戻す
    `;
    
    // ポップアップが閉じられたらメインウィンドウに要素を戻す
    fallbackPopup.addEventListener('beforeunload', () => {
        fallbackPopup = null;
        returnContainerToMainWindow();
    });
}

/**
 * ミニウィンドウを閉じる
 */
function closeMiniWindow() {
    if (pipWindow) {
        pipWindow.close();
        pipWindow = null;
    }
    if (fallbackPopup) {
        fallbackPopup.close();
        fallbackPopup = null;
    }
    returnContainerToMainWindow();
}

/**
 * タイマー要素をメインウィンドウの元の位置に戻す
 */
function returnContainerToMainWindow() {
    const mainMain = document.querySelector('.app-main');
    
    // タイマーコンテナがメインウィンドウにない場合のみ戻す
    if (!document.getElementById('timer-container')) {
        mainMain.appendChild(timerContainer);
    }
    
    // ボタンのテキストをリセット
    const isPiPSupported = 'documentPictureInPicture' in window;
    pipBtn.innerHTML = isPiPSupported ? `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><path d="M7 2h10"></path><rect x="14" y="14" width="8" height="8" rx="1" ry="1"></rect></svg>
        常に手前に表示 (ミニウィンドウ)
    ` : `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><path d="M7 2h10"></path><rect x="14" y="14" width="8" height="8" rx="1" ry="1"></rect></svg>
        別ウィンドウで開く (ミニ表示)
    `;
}
