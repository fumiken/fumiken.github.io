/**
 * GPS Tracker Application
 * リアルタイムGPS追跡と速度計算を提供するWebアプリケーション
 */

/**
 * LocationTrackerクラス
 * GPS追跡と速度計算を管理するメインクラス
 */
class LocationTracker {
    constructor() {
        // DOM要素の参照
        this.elements = {
            statusText: document.getElementById('status-text'),
            statusIndicator: document.getElementById('status-indicator'),
            latitude: document.getElementById('latitude'),
            longitude: document.getElementById('longitude'),
            accuracy: document.getElementById('accuracy'),
            speedValue: document.getElementById('speed-value'),
            timestamp: document.getElementById('timestamp'),
            errorMessages: document.getElementById('error-messages')
        };
        
        // 追跡状態
        this.isTracking = false;
        this.watchId = null;
        this.updateInterval = null;
        this.lastPeriodicError = null; // 定期更新エラーの重複を避けるため
        this.lastAccuracyLevel = null; // 精度レベル変化の追跡用
        
        // 位置データ履歴（速度計算用）
        this.positionHistory = [];
        this.maxHistorySize = 5;
        
        // エラー状態での位置維持 - 要件2.3対応
        this.lastKnownPosition = null; // 最後に成功した位置データ
        this.errorState = {
            hasError: false,
            errorType: null,
            errorStartTime: null,
            consecutiveErrors: 0
        };
        
        // 設定
        this.config = {
            updateInterval: 1000, // 1秒間隔
            coordinatePrecision: 6, // 座標の小数点以下桁数
            speedPrecision: 1, // 速度の小数点以下桁数
            accuracyThreshold: 100, // 精度警告の閾値（メートル）
            minSpeedThreshold: 0.1 // 最小速度閾値（km/h）
        };
        
        // エラーログシステム - 要件5.5対応
        this.errorLogger = {
            logs: [],
            maxLogs: 100, // 最大ログ保持数
            logLevels: ['error', 'warning', 'info', 'debug'],
            sessionId: this.generateSessionId()
        };
        
        // ネットワーク状態監視
        this.networkStatus = {
            isOnline: navigator.onLine,
            lastCheck: Date.now()
        };
        
        // エラーログシステムを初期化 - 要件5.5対応
        this.initializeErrorLogging();
        
        // 初期化
        this.init();
    }
    
    /**
     * エラーログシステムを初期化 - 要件5.5対応
     */
    initializeErrorLogging() {
        // 保存されたログを読み込み
        this.loadLogsFromStorage();
        
        // グローバルエラーハンドラーを設定
        window.addEventListener('error', (event) => {
            this.handleUnexpectedError(event.error || new Error(event.message), 'global_error');
        });
        
        // Promise拒否エラーハンドラーを設定
        window.addEventListener('unhandledrejection', (event) => {
            this.handleUnexpectedError(
                new Error(event.reason || 'Unhandled promise rejection'), 
                'unhandled_promise'
            );
        });
        
        // 初期化ログを記録
        this.logError('info', 'GPS Tracker error logging system initialized', {
            context: 'initialization',
            sessionId: this.errorLogger.sessionId,
            timestamp: new Date().toISOString()
        });
        
        console.log('Error logging system initialized with session ID:', this.errorLogger.sessionId);
    }
    
    /**
     * アプリケーションの初期化
     */
    init() {
        try {
            console.log('GPS Tracker initializing...');
            this.updateStatus('初期化中...', 'loading');
            
            // Geolocation APIのサポート確認 - 要件5.1対応
            if (!this.isGeolocationSupported()) {
                this.showBrowserCompatibilityError();
                return;
            }
            
            // 許可再試行ボタンを追加
            this.addPermissionRetryButton();
            
            // ネットワーク状態監視を開始 - 要件5.3対応
            this.setupNetworkMonitoring();
            
            // 自動的に追跡を開始
            this.startTracking();
            
            // 初期化完了ログ
            this.logError('info', 'GPS Tracker initialization completed successfully', {
                context: 'initialization'
            });
            
        } catch (error) {
            this.handleUnexpectedError(error, 'initialization');
        }
    }
    
    /**
     * 許可再試行ボタンを追加
     */
    addPermissionRetryButton() {
        const retryButton = document.createElement('button');
        retryButton.id = 'permission-retry-btn';
        retryButton.textContent = '位置情報許可を再試行';
        retryButton.className = 'retry-button';
        retryButton.style.display = 'none';
        retryButton.addEventListener('click', () => {
            this.clearErrors();
            retryButton.style.display = 'none';
            this.startTracking();
        });
        
        // エラーメッセージセクションの後に追加
        this.elements.errorMessages.parentNode.insertBefore(
            retryButton, 
            this.elements.errorMessages.nextSibling
        );
        
        this.elements.retryButton = retryButton;
    }
    
    /**
     * Geolocation APIのサポート確認
     * @returns {boolean} サポートされている場合はtrue
     */
    isGeolocationSupported() {
        return 'geolocation' in navigator;
    }
    
    /**
     * ブラウザ互換性エラーメッセージを表示 - 要件5.1対応
     */
    showBrowserCompatibilityError() {
        const errorMessage = 'このブラウザはGeolocation API（位置情報サービス）をサポートしていません。' +
                           '以下のブラウザの最新版をご利用ください：\n' +
                           '• Google Chrome\n' +
                           '• Mozilla Firefox\n' +
                           '• Safari\n' +
                           '• Microsoft Edge';
        
        this.showError(errorMessage);
        this.updateStatus('ブラウザ非対応', 'error');
    }
    
    /**
     * 位置サービス無効時の指示を表示 - 要件5.2対応
     */
    showLocationServiceInstructions() {
        const instructions = '位置サービスが無効になっています。以下の手順で有効にしてください：\n\n' +
                           '【デスクトップブラウザ】\n' +
                           '1. アドレスバーの左側にある鍵アイコンをクリック\n' +
                           '2. 「位置情報」を「許可」に変更\n' +
                           '3. ページを再読み込み\n\n' +
                           '【スマートフォン】\n' +
                           '1. 端末の設定 > プライバシー > 位置情報サービス\n' +
                           '2. 位置情報サービスをオンにする\n' +
                           '3. ブラウザアプリの位置情報アクセスを許可';
        
        this.showError(instructions);
    }
    
    /**
     * GPS追跡を開始
     */
    async startTracking() {
        if (this.isTracking) {
            console.log('Tracking is already active');
            return;
        }
        
        console.log('Starting GPS tracking...');
        this.updateStatus('位置許可を要求中...', 'loading');
        
        // ネットワーク状態を確認
        if (!this.checkNetworkStatus()) {
            this.showWarning('オフライン状態です。位置情報の精度が制限される可能性があります。');
        }
        
        // 位置許可の状態を確認
        try {
            await this.requestLocationPermission();
        } catch (error) {
            console.error('Permission request failed:', error);
            return;
        }
        
        // 位置の継続監視を開始
        this.startWatchingPosition();
        
        this.isTracking = true;
    }
    
    /**
     * 位置許可を要求し、許可状態を処理
     * @returns {Promise<void>} 許可が得られた場合は解決、拒否された場合は拒否
     */
    async requestLocationPermission() {
        // Permissions APIが利用可能な場合は事前に許可状態を確認
        if ('permissions' in navigator) {
            try {
                const permission = await navigator.permissions.query({ name: 'geolocation' });
                console.log('Current permission state:', permission.state);
                
                switch (permission.state) {
                    case 'granted':
                        console.log('Location permission already granted');
                        return Promise.resolve();
                    case 'denied':
                        this.showError('位置情報の許可が拒否されています。ブラウザの設定で位置情報を有効にしてください。');
                        this.updateStatus('許可拒否', 'error');
                        return Promise.reject(new Error('Permission denied'));
                    case 'prompt':
                        console.log('Permission will be requested');
                        break;
                }
                
                // 許可状態の変更を監視
                permission.addEventListener('change', () => {
                    console.log('Permission state changed to:', permission.state);
                    if (permission.state === 'denied') {
                        this.stopTracking();
                        this.showError('位置情報の許可が取り消されました。');
                    }
                });
                
            } catch (error) {
                console.warn('Permissions API not fully supported:', error);
            }
        }
        
        // 実際の位置取得を試行して許可を要求
        return new Promise((resolve, reject) => {
            const options = {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            };
            
            // getCurrentPosition()を使用して初回位置を取得
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log('Initial position obtained, permission granted');
                    // 初回位置データを即座に表示
                    this.onPositionSuccess(position);
                    resolve();
                },
                (error) => {
                    console.error('Permission request failed:', error);
                    this.handlePermissionError(error);
                    reject(error);
                },
                options
            );
        });
    }
    
    /**
     * 許可要求時のエラーを処理 - 要件1.3, 5.1, 5.2, 5.5対応
     * @param {GeolocationPositionError} error エラー情報
     */
    handlePermissionError(error) {
        let errorMessage = '';
        let showRetryButton = false;
        
        // エラーログを記録 - 要件5.5対応
        this.logError('error', 'Permission request failed', {
            context: 'permission_request',
            errorCode: error.code,
            errorMessage: error.message
        }, error);
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                // 要件5.2対応 - 位置サービス有効化の指示を提供
                this.showLocationServiceInstructions();
                this.updateStatus('許可拒否', 'error');
                showRetryButton = true;
                break;
            case error.POSITION_UNAVAILABLE:
                // 要件1.3対応 - 位置データが利用できない場合の適切なエラーメッセージ
                errorMessage = '位置情報が利用できません。以下をご確認ください：\n' +
                             '• GPS機能が有効になっているか\n' +
                             '• 屋外または窓の近くにいるか\n' +
                             '• ネットワーク接続が安定しているか\n' +
                             '• 位置情報サービスが有効になっているか';
                this.showError(errorMessage);
                this.updateStatus('位置情報なし', 'error');
                showRetryButton = true;
                break;
            case error.TIMEOUT:
                // タイムアウトエラーの詳細な処理
                errorMessage = '位置情報の取得がタイムアウトしました（15秒）。\n' +
                             '以下をお試しください：\n' +
                             '• 屋外に移動する\n' +
                             '• WiFiまたはモバイルデータ接続を確認\n' +
                             '• 端末を再起動する\n' +
                             '• しばらく待ってから再試行する';
                this.showError(errorMessage);
                this.updateStatus('タイムアウト', 'error');
                showRetryButton = true;
                break;
            default:
                // 予期しないエラーの処理 - 要件5.5対応
                this.handleUnexpectedError(error, 'permission_request');
                showRetryButton = true;
                break;
        }
        
        // 再試行ボタンを表示
        if (showRetryButton && this.elements.retryButton) {
            this.elements.retryButton.style.display = 'block';
        }
    }
    
    /**
     * GPS追跡を停止
     */
    stopTracking() {
        if (!this.isTracking) {
            return;
        }
        
        console.log('Stopping GPS tracking...');
        
        // watchPosition()を停止
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
        
        // 定期更新を停止
        this.stopPeriodicUpdates();
        
        // ネットワーク監視を停止
        this.stopNetworkMonitoring();
        
        this.isTracking = false;
        this.updateStatus('追跡停止', 'error');
    }
    
    /**
     * 現在位置を一度だけ取得（getCurrentPosition使用）
     * @returns {Promise<GeolocationPosition>} 位置情報のPromise
     */
    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            const options = {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000 // 1分以内のキャッシュを許可
            };
            
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log('Current position obtained:', position);
                    resolve(position);
                },
                (error) => {
                    console.error('Failed to get current position:', error);
                    reject(error);
                },
                options
            );
        });
    }
    
    /**
     * 位置の継続監視を開始（watchPosition使用）
     */
    startWatchingPosition() {
        if (this.watchId !== null) {
            console.log('Already watching position');
            return;
        }
        
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0 // 常に最新の位置を取得
        };
        
        console.log('Starting position watch...');
        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.onPositionSuccess(position),
            (error) => this.onPositionError(error),
            options
        );
        
        // 1秒間隔での定期更新を開始 - 要件2.1対応
        this.startPeriodicUpdates();
    }
    
    /**
     * 1秒間隔での定期更新を開始 - 要件2.1, 2.2対応
     */
    startPeriodicUpdates() {
        if (this.updateInterval !== null) {
            console.log('Periodic updates already running');
            return;
        }
        
        console.log('Starting periodic position updates (1 second interval)...');
        
        // setInterval()を使用した1秒間隔の定期更新
        this.updateInterval = setInterval(() => {
            this.requestPositionUpdate();
        }, this.config.updateInterval);
    }
    
    /**
     * 位置更新を要求（1秒間隔で呼び出される）
     */
    requestPositionUpdate() {
        if (!this.isTracking) {
            console.log('Tracking stopped, clearing periodic updates');
            this.stopPeriodicUpdates();
            return;
        }
        
        // getCurrentPosition()を使用して最新の位置を取得
        const options = {
            enableHighAccuracy: true,
            timeout: 5000, // 短いタイムアウト（1秒間隔のため）
            maximumAge: 0 // 常に最新の位置を要求
        };
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                // 位置データを処理
                this.onPositionSuccess(position);
            },
            (error) => {
                // エラーが発生しても継続的に更新を試行
                console.warn('Position update failed, will retry in 1 second:', error);
                this.handlePeriodicUpdateError(error);
            },
            options
        );
    }
    
    /**
     * 定期更新中のエラーを処理 - 要件2.3対応
     * @param {GeolocationPositionError} error エラー情報
     */
    handlePeriodicUpdateError(error) {
        // エラー状態を更新
        this.updateErrorState(error);
        
        // 最後の位置を維持し、エラーインジケーターを表示
        let errorMessage = '';
        let shouldMaintainPosition = true;
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                // 許可が取り消された場合は追跡を停止
                errorMessage = '位置情報の許可が取り消されました。';
                shouldMaintainPosition = false;
                this.stopTracking();
                this.showError(errorMessage);
                return;
            case error.POSITION_UNAVAILABLE:
                // 位置が利用できない場合は最後の位置を維持
                errorMessage = 'GPS信号が一時的に利用できません。最後の位置を表示しています。';
                this.updateStatus('信号なし', 'error');
                break;
            case error.TIMEOUT:
                // タイムアウトの場合は次の更新を待つ
                console.log('Position update timeout, will retry in next interval');
                this.updateStatus('更新中...', 'loading');
                // 頻繁なタイムアウトの場合のみメッセージを表示
                if (this.errorState.consecutiveErrors > 3) {
                    errorMessage = '位置情報の取得に時間がかかっています。最後の位置を表示しています。';
                } else {
                    return; // エラーメッセージは表示しない
                }
                break;
            default:
                errorMessage = '位置更新中にエラーが発生しました。最後の位置を表示しています。';
                break;
        }
        
        // 最後の位置を維持してエラーインジケーターを表示
        if (shouldMaintainPosition) {
            this.maintainLastKnownPosition();
            this.showErrorIndicator(error);
        }
        
        // エラーメッセージを表示（ただし、同じエラーの重複を避ける）
        if (this.lastPeriodicError !== error.code || this.errorState.consecutiveErrors === 1) {
            this.showWarning(errorMessage);
            this.lastPeriodicError = error.code;
        }
    }
    
    /**
     * エラー状態を更新 - 要件2.3対応
     * @param {GeolocationPositionError} error エラー情報
     */
    updateErrorState(error) {
        if (!this.errorState.hasError) {
            this.errorState.hasError = true;
            this.errorState.errorStartTime = Date.now();
            this.errorState.consecutiveErrors = 1;
        } else {
            this.errorState.consecutiveErrors++;
        }
        
        this.errorState.errorType = error.code;
        
        console.log(`Error state updated: ${this.errorState.consecutiveErrors} consecutive errors, type: ${error.code}`);
    }
    
    /**
     * エラー状態をクリア
     */
    clearErrorState() {
        if (this.errorState.hasError) {
            const errorDuration = Date.now() - this.errorState.errorStartTime;
            console.log(`Error state cleared after ${Math.round(errorDuration / 1000)} seconds`);
        }
        
        this.errorState = {
            hasError: false,
            errorType: null,
            errorStartTime: null,
            consecutiveErrors: 0
        };
    }
    
    /**
     * 最後に知られた位置を維持 - 要件2.3対応
     */
    maintainLastKnownPosition() {
        if (!this.lastKnownPosition) {
            console.warn('No last known position to maintain');
            return;
        }
        
        console.log('Maintaining last known position:', this.lastKnownPosition);
        
        // 最後の位置データを使用して表示を更新（タイムスタンプは更新しない）
        const maintainedData = {
            ...this.lastKnownPosition,
            // タイムスタンプは最後に成功した時のものを保持
            maintained: true // 維持されたデータであることを示すフラグ
        };
        
        // 座標と精度のみ更新（タイムスタンプは維持）
        this.elements.latitude.textContent = this.formatCoordinate(maintainedData.latitude);
        this.elements.longitude.textContent = this.formatCoordinate(maintainedData.longitude);
        this.elements.accuracy.textContent = this.formatAccuracy(maintainedData.accuracy);
        
        // 精度レベル表示も維持
        this.updateAccuracyWarning(maintainedData.accuracy);
    }
    
    /**
     * エラーインジケーターを表示 - 要件2.3対応
     * @param {GeolocationPositionError} error エラー情報
     */
    showErrorIndicator(error) {
        // エラーインジケーター要素を取得または作成
        let errorIndicator = document.getElementById('error-indicator');
        if (!errorIndicator) {
            errorIndicator = document.createElement('div');
            errorIndicator.id = 'error-indicator';
            errorIndicator.className = 'error-indicator';
            
            // ステータスセクションの後に挿入
            const statusSection = document.querySelector('.status-section');
            statusSection.parentNode.insertBefore(errorIndicator, statusSection.nextSibling);
        }
        
        // エラータイプに応じたメッセージとアイコン
        let iconClass, message;
        switch (error.code) {
            case error.POSITION_UNAVAILABLE:
                iconClass = 'signal-lost';
                message = 'GPS信号なし';
                break;
            case error.TIMEOUT:
                iconClass = 'timeout';
                message = '更新タイムアウト';
                break;
            default:
                iconClass = 'error';
                message = '位置更新エラー';
                break;
        }
        
        // エラーインジケーターの内容を更新
        errorIndicator.innerHTML = `
            <div class="error-indicator-content">
                <span class="error-icon ${iconClass}">⚠️</span>
                <span class="error-message">${message}</span>
                <span class="error-count">${this.errorState.consecutiveErrors}回</span>
            </div>
            <div class="error-indicator-subtitle">
                最後の位置を表示中
            </div>
        `;
        
        errorIndicator.style.display = 'block';
    }
    
    /**
     * エラーインジケーターを非表示
     */
    hideErrorIndicator() {
        const errorIndicator = document.getElementById('error-indicator');
        if (errorIndicator) {
            errorIndicator.style.display = 'none';
        }
    }
    
    /**
     * 定期更新を停止
     */
    stopPeriodicUpdates() {
        if (this.updateInterval !== null) {
            console.log('Stopping periodic updates...');
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        // エラー状態をリセット
        this.lastPeriodicError = null;
    }
    
    /**
     * 位置取得成功時のコールバック
     * @param {GeolocationPosition} position 位置情報
     */
    onPositionSuccess(position) {
        console.log('Position received:', position);
        
        // 位置データを構造化 - 要件1.2に対応
        const locationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            timestamp: position.timestamp
        };
        
        // データの妥当性を確認
        if (!this.isValidLocationData(locationData)) {
            console.warn('Invalid location data received:', locationData);
            return;
        }
        
        // 最後に成功した位置データを保存 - 要件2.3対応
        this.lastKnownPosition = { ...locationData };
        
        // エラー状態をリセット
        this.clearErrorState();
        
        // 位置履歴に追加
        this.addToPositionHistory(locationData);
        
        // 表示を更新
        this.updateDisplay(locationData);
        
        // ステータスを更新
        this.updateStatus('追跡中', 'active');
        
        // エラーメッセージをクリア
        this.clearErrors();
        
        // 再試行ボタンを非表示
        if (this.elements.retryButton) {
            this.elements.retryButton.style.display = 'none';
        }
        
        // エラーインジケーターを非表示
        this.hideErrorIndicator();
    }
    
    /**
     * 位置データの妥当性を確認
     * @param {Object} locationData 位置データ
     * @returns {boolean} 有効な場合はtrue
     */
    isValidLocationData(locationData) {
        // 緯度と経度が有効な範囲内かチェック
        if (typeof locationData.latitude !== 'number' || 
            typeof locationData.longitude !== 'number') {
            return false;
        }
        
        if (locationData.latitude < -90 || locationData.latitude > 90) {
            return false;
        }
        
        if (locationData.longitude < -180 || locationData.longitude > 180) {
            return false;
        }
        
        // 精度が負の値でないかチェック
        if (locationData.accuracy < 0) {
            return false;
        }
        
        // タイムスタンプが有効かチェック
        if (!locationData.timestamp || locationData.timestamp <= 0) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 位置取得エラー時のコールバック - 要件1.3, 5.1, 5.2, 5.5対応
     * @param {GeolocationPositionError} error エラー情報
     */
    onPositionError(error) {
        // エラーログを記録 - 要件5.5対応
        this.logError('error', 'Position error during tracking', {
            context: 'position_tracking',
            errorCode: error.code,
            errorMessage: error.message,
            isTracking: this.isTracking,
            watchId: this.watchId
        }, error);
        
        let errorMessage = '';
        let shouldStopTracking = false;
        
        switch (error.code) {
            case error.PERMISSION_DENIED:
                // 追跡中に許可が取り消された場合
                errorMessage = '位置情報の許可が取り消されました。追跡を停止します。\n' +
                             'ブラウザの設定で位置情報を再度許可してから、再試行ボタンをクリックしてください。';
                shouldStopTracking = true;
                this.updateStatus('許可取り消し', 'error');
                break;
            case error.POSITION_UNAVAILABLE:
                // 追跡中に位置が利用できなくなった場合 - 要件2.3対応（最後の位置を維持）
                errorMessage = '一時的に位置情報が利用できません。最後の位置を表示しています。\n' +
                             'GPS信号の回復を待っています...';
                this.updateStatus('信号なし', 'error');
                // 追跡は継続（最後の位置を維持）
                break;
            case error.TIMEOUT:
                // 追跡中のタイムアウト
                errorMessage = '位置情報の更新がタイムアウトしました。\n' +
                             '信号の回復を待っています...';
                this.updateStatus('更新タイムアウト', 'error');
                // 追跡は継続
                break;
            default:
                // 予期しないエラー - 要件5.5対応
                this.handleUnexpectedError(error, 'position_tracking');
                // 追跡は継続
                break;
        }
        
        this.showError(errorMessage);
        
        // 必要に応じて追跡を停止
        if (shouldStopTracking) {
            this.stopTracking();
            // 再試行ボタンを表示
            if (this.elements.retryButton) {
                this.elements.retryButton.style.display = 'block';
            }
        }
    }
    
    /**
     * 位置履歴に新しい位置データを追加
     * @param {Object} locationData 位置データ
     */
    addToPositionHistory(locationData) {
        this.positionHistory.push(locationData);
        
        // 履歴サイズを制限
        if (this.positionHistory.length > this.maxHistorySize) {
            this.positionHistory.shift();
        }
    }
    
    /**
     * 2つの位置間の距離をハヴァーサイン公式で計算
     * @param {Object} pos1 最初の位置 {latitude, longitude}
     * @param {Object} pos2 2番目の位置 {latitude, longitude}
     * @returns {number} 距離（キロメートル）
     */
    calculateDistance(pos1, pos2) {
        // 地球の半径（キロメートル）
        const EARTH_RADIUS_KM = 6371;
        
        // 度をラジアンに変換
        const lat1Rad = this.degreesToRadians(pos1.latitude);
        const lat2Rad = this.degreesToRadians(pos2.latitude);
        const deltaLatRad = this.degreesToRadians(pos2.latitude - pos1.latitude);
        const deltaLonRad = this.degreesToRadians(pos2.longitude - pos1.longitude);
        
        // ハヴァーサイン公式
        const a = Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
                  Math.cos(lat1Rad) * Math.cos(lat2Rad) *
                  Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        
        // 距離を計算（キロメートル）
        const distance = EARTH_RADIUS_KM * c;
        
        return distance;
    }
    
    /**
     * 度をラジアンに変換
     * @param {number} degrees 度
     * @returns {number} ラジアン
     */
    degreesToRadians(degrees) {
        return degrees * (Math.PI / 180);
    }
    
    /**
     * 2つの位置間の速度を計算 - 要件3.1, 3.3, 3.5対応
     * @param {Object} prevPos 前の位置
     * @param {Object} currentPos 現在の位置
     * @returns {number} 速度（km/h）
     */
    calculateSpeed(prevPos, currentPos) {
        // データ不足時の処理 - 要件3.3対応
        if (!prevPos || !currentPos) {
            return 0.0;
        }
        
        // 必要なプロパティが存在するかチェック
        if (typeof prevPos.latitude !== 'number' || typeof prevPos.longitude !== 'number' ||
            typeof currentPos.latitude !== 'number' || typeof currentPos.longitude !== 'number' ||
            typeof prevPos.timestamp !== 'number' || typeof currentPos.timestamp !== 'number') {
            return 0.0;
        }
        
        // 時間差を計算（秒）
        const timeDiffSeconds = (currentPos.timestamp - prevPos.timestamp) / 1000;
        
        // 時間差が0または負の場合は0を返す - 要件3.3対応
        if (timeDiffSeconds <= 0) {
            return 0.0;
        }
        
        // 距離を計算（キロメートル）
        const distanceKm = this.calculateDistance(prevPos, currentPos);
        
        // 静止状態の判定 - 要件3.5対応
        if (this.isStationary(distanceKm, timeDiffSeconds)) {
            return 0.0;
        }
        
        // 速度を計算（km/h）
        const speedKmh = (distanceKm / timeDiffSeconds) * 3600; // 秒を時間に変換
        
        // 異常に高い速度の場合は0を返す（GPS誤差による異常値を除外）
        if (speedKmh > 500) { // 500 km/h以上は異常値とみなす
            console.warn(`Abnormally high speed detected: ${speedKmh.toFixed(1)} km/h, treating as stationary`);
            return 0.0;
        }
        
        return speedKmh;
    }
    
    /**
     * 静止状態かどうかを判定 - 要件3.5対応
     * @param {number} distanceKm 移動距離（キロメートル）
     * @param {number} timeDiffSeconds 時間差（秒）
     * @returns {boolean} 静止状態の場合はtrue
     */
    isStationary(distanceKm, timeDiffSeconds) {
        // 非常に短い距離の場合は静止とみなす
        if (distanceKm < 0.001) { // 1メートル未満
            return true;
        }
        
        // 速度が最小閾値未満の場合は静止とみなす
        const speedKmh = (distanceKm / timeDiffSeconds) * 3600;
        if (speedKmh < this.config.minSpeedThreshold) {
            return true;
        }
        
        return false;
    }
    
    /**
     * 速度計算の信頼性を判定 - 要件3.4対応
     * @param {Object} prevPos 前の位置
     * @param {Object} currentPos 現在の位置
     * @returns {string} 信頼性レベル（'high', 'medium', 'low'）
     */
    calculateSpeedReliability(prevPos, currentPos) {
        if (!prevPos || !currentPos) {
            return 'unknown';
        }
        
        // 精度の平均を計算
        const avgAccuracy = (prevPos.accuracy + currentPos.accuracy) / 2;
        
        // 時間差を計算
        const timeDiffSeconds = (currentPos.timestamp - prevPos.timestamp) / 1000;
        
        // 距離を計算
        const distanceKm = this.calculateDistance(prevPos, currentPos);
        const distanceM = distanceKm * 1000;
        
        // 信頼性判定の基準
        // 1. 精度が良好（50m以下）で、移動距離が精度の2倍以上
        if (avgAccuracy <= 50 && distanceM >= (avgAccuracy * 2) && timeDiffSeconds >= 2) {
            return 'high';
        }
        
        // 2. 精度が中程度（100m以下）で、移動距離が精度以上
        if (avgAccuracy <= 100 && distanceM >= avgAccuracy && timeDiffSeconds >= 1) {
            return 'medium';
        }
        
        // 3. その他の場合は低信頼性
        return 'low';
    }
    
    /**
     * 新しいデータでUIを更新
     * @param {Object} locationData 位置データ
     */
    updateDisplay(locationData) {
        try {
            // 座標を表示（小数点以下6桁）- 要件1.4に対応
            this.elements.latitude.textContent = this.formatCoordinate(locationData.latitude);
            this.elements.longitude.textContent = this.formatCoordinate(locationData.longitude);
            
            // 精度を表示
            this.elements.accuracy.textContent = this.formatAccuracy(locationData.accuracy);
            
            // タイムスタンプを表示
            const timestamp = new Date(locationData.timestamp);
            this.elements.timestamp.textContent = this.formatTimestamp(timestamp);
            
            // タイムスタンプ更新アニメーションを追加
            const timestampSection = document.querySelector('.timestamp-section');
            if (timestampSection) {
                timestampSection.classList.add('updated');
                setTimeout(() => {
                    timestampSection.classList.remove('updated');
                }, 500);
            }
            
            // 速度計算と表示 - 要件3.1, 3.2, 3.3, 3.4, 3.5対応
            let speed = 0.0;
            let speedStatus = 'insufficient-data'; // データ不足
            let speedReliability = 'unknown';
            
            if (this.positionHistory.length >= 2) {
                // 最新の2つの位置から速度を計算
                const prevPos = this.positionHistory[this.positionHistory.length - 2];
                const currentPos = locationData;
                speed = this.calculateSpeed(prevPos, currentPos);
                
                // 速度の信頼性を判定 - 要件3.4対応
                speedReliability = this.calculateSpeedReliability(prevPos, currentPos);
                
                // 速度状態を判定
                if (speed === 0.0) {
                    speedStatus = 'stationary'; // 静止状態
                } else {
                    speedStatus = 'moving'; // 移動中
                }
            }
            
            // 速度をフォーマットして表示（km/h単位、小数点以下1桁）
            this.elements.speedValue.textContent = this.formatSpeed(speed);
            
            // 速度表示要素にステータスクラスを追加
            this.updateSpeedDisplayStatus(speedStatus, speedReliability);
            
            // 低精度警告を表示 - 要件3.4対応
            this.updateSpeedReliabilityWarning(speedReliability, locationData.accuracy);
            
            // 精度レベルに基づく警告表示
            this.updateAccuracyWarning(locationData.accuracy);
            
            // GPS信号強度を監視し、弱信号時の警告を表示 - 要件5.4対応
            this.monitorSignalStrength(locationData.accuracy, locationData.timestamp);
            
        } catch (error) {
            this.handleUnexpectedError(error, 'ui_update');
        }
    }
    
    /**
     * 座標を指定された精度でフォーマット
     * @param {number} coordinate 座標値
     * @returns {string} フォーマットされた座標文字列
     */
    formatCoordinate(coordinate) {
        return coordinate.toFixed(this.config.coordinatePrecision);
    }
    
    /**
     * 精度情報をフォーマット
     * @param {number} accuracy 精度値（メートル）
     * @returns {string} フォーマットされた精度文字列
     */
    formatAccuracy(accuracy) {
        const roundedAccuracy = Math.round(accuracy);
        return `±${roundedAccuracy}m`;
    }
    
    /**
     * 速度値をフォーマット - 要件3.2対応
     * @param {number} speed 速度値（km/h）
     * @returns {string} フォーマットされた速度文字列
     */
    formatSpeed(speed) {
        // 小数点以下1桁でフォーマット
        return speed.toFixed(this.config.speedPrecision);
    }
    
    /**
     * 速度表示のステータスを更新 - 要件3.3, 3.4, 3.5対応
     * @param {string} status 速度ステータス（'insufficient-data', 'stationary', 'moving'）
     * @param {string} reliability 信頼性レベル（'high', 'medium', 'low', 'unknown'）
     */
    updateSpeedDisplayStatus(status, reliability = 'unknown') {
        const speedSection = document.querySelector('.speed-section');
        if (!speedSection) return;
        
        // 既存のステータスクラスを削除
        speedSection.classList.remove('insufficient-data', 'stationary', 'moving', 'high-reliability', 'medium-reliability', 'low-reliability');
        
        // 新しいステータスクラスを追加
        speedSection.classList.add(status);
        if (reliability !== 'unknown') {
            speedSection.classList.add(`${reliability}-reliability`);
        }
        
        // ステータスに応じた追加情報を表示
        let statusElement = document.getElementById('speed-status');
        if (!statusElement) {
            statusElement = document.createElement('div');
            statusElement.id = 'speed-status';
            statusElement.className = 'speed-status';
            speedSection.appendChild(statusElement);
        }
        
        switch (status) {
            case 'insufficient-data':
                statusElement.textContent = '位置データ収集中...';
                statusElement.className = 'speed-status insufficient-data';
                break;
            case 'stationary':
                statusElement.textContent = '静止中';
                statusElement.className = 'speed-status stationary';
                break;
            case 'moving':
                // 信頼性に応じたステータス表示
                let reliabilityText = '';
                switch (reliability) {
                    case 'high':
                        reliabilityText = '高精度';
                        break;
                    case 'medium':
                        reliabilityText = '中精度';
                        break;
                    case 'low':
                        reliabilityText = '低精度';
                        break;
                    default:
                        reliabilityText = '';
                        break;
                }
                statusElement.textContent = reliabilityText;
                statusElement.className = `speed-status moving ${reliability}-reliability`;
                break;
        }
    }
    
    /**
     * 速度信頼性警告を更新 - 要件3.4対応
     * @param {string} reliability 信頼性レベル
     * @param {number} accuracy 現在の精度（メートル）
     */
    updateSpeedReliabilityWarning(reliability, accuracy) {
        let warningElement = document.getElementById('speed-reliability-warning');
        
        // 低信頼性の場合のみ警告を表示
        if (reliability === 'low') {
            if (!warningElement) {
                warningElement = document.createElement('div');
                warningElement.id = 'speed-reliability-warning';
                warningElement.className = 'speed-reliability-warning';
                
                // 速度セクションの後に挿入
                const speedSection = document.querySelector('.speed-section');
                speedSection.parentNode.insertBefore(warningElement, speedSection.nextSibling);
            }
            
            // 警告メッセージを設定
            let warningMessage = '⚠️ 速度の信頼性が低下しています';
            let recommendation = '';
            
            if (accuracy > 100) {
                recommendation = 'GPS精度が低いため、速度計算が不正確な可能性があります。屋外に移動するか、WiFi接続を確認してください。';
            } else {
                recommendation = '移動距離が短いため、速度計算の精度が制限されています。';
            }
            
            warningElement.innerHTML = `
                <div class="warning-header">${warningMessage}</div>
                <div class="warning-details">
                    <small>${recommendation}</small>
                    <div class="warning-accuracy">現在の精度: ±${Math.round(accuracy)}m</div>
                </div>
            `;
            
            warningElement.style.display = 'block';
        } else {
            // 信頼性が改善された場合は警告を非表示
            if (warningElement) {
                warningElement.style.display = 'none';
            }
        }
    }
    
    /**
     * 精度レベルに基づく警告を更新 - 要件2.5対応
     * @param {number} accuracy 精度値（メートル）
     */
    updateAccuracyWarning(accuracy) {
        const accuracyElement = this.elements.accuracy.parentElement;
        
        // 既存の警告クラスを削除
        accuracyElement.classList.remove('bg-warning', 'bg-danger', 'bg-success', 'bg-info');
        
        // 精度レベルを判定し、適切な表示を設定
        const accuracyLevel = this.getAccuracyLevel(accuracy);
        
        // 精度レベルに基づいてスタイルを適用
        switch (accuracyLevel.level) {
            case 'excellent':
                accuracyElement.classList.add('bg-success');
                break;
            case 'good':
                accuracyElement.classList.add('bg-info');
                break;
            case 'fair':
                accuracyElement.classList.add('bg-warning');
                break;
            case 'poor':
                accuracyElement.classList.add('bg-danger');
                break;
        }
        
        // 精度レベル情報を表示に追加
        this.displayAccuracyLevel(accuracyLevel);
    }
    
    /**
     * 精度値から精度レベルを判定 - 要件2.5対応
     * @param {number} accuracy 精度値（メートル）
     * @returns {Object} 精度レベル情報
     */
    getAccuracyLevel(accuracy) {
        let level, description, recommendation;
        
        if (accuracy <= 5) {
            level = 'excellent';
            description = '非常に高精度';
            recommendation = '位置情報は非常に正確です';
        } else if (accuracy <= 20) {
            level = 'good';
            description = '高精度';
            recommendation = '位置情報は正確です';
        } else if (accuracy <= 100) {
            level = 'fair';
            description = '中精度';
            recommendation = '位置情報はおおよそ正確です';
        } else {
            level = 'poor';
            description = '低精度';
            recommendation = '位置情報の精度が低下しています。屋外に移動するか、WiFi接続を確認してください';
        }
        
        return {
            level,
            description,
            recommendation,
            accuracy: Math.round(accuracy)
        };
    }
    
    /**
     * 精度レベル情報を表示 - 要件2.5対応
     * @param {Object} accuracyLevel 精度レベル情報
     */
    displayAccuracyLevel(accuracyLevel) {
        // 精度レベル表示要素を取得または作成
        let accuracyLevelElement = document.getElementById('accuracy-level');
        if (!accuracyLevelElement) {
            accuracyLevelElement = document.createElement('div');
            accuracyLevelElement.id = 'accuracy-level';
            accuracyLevelElement.className = 'accuracy-level-display';
            
            // 精度表示の後に挿入
            const accuracyDisplay = this.elements.accuracy.parentElement;
            accuracyDisplay.parentNode.insertBefore(accuracyLevelElement, accuracyDisplay.nextSibling);
        }
        
        // 精度レベル情報を表示
        accuracyLevelElement.innerHTML = `
            <div class="accuracy-level-info">
                <span class="accuracy-level-label">精度レベル:</span>
                <span class="accuracy-level-value ${accuracyLevel.level}">${accuracyLevel.description}</span>
            </div>
            <div class="accuracy-recommendation">
                <small>${accuracyLevel.recommendation}</small>
            </div>
        `;
        
        // 精度が変化した場合のログ出力
        if (this.lastAccuracyLevel !== accuracyLevel.level) {
            console.log(`Accuracy level changed: ${this.lastAccuracyLevel || 'unknown'} → ${accuracyLevel.level} (±${accuracyLevel.accuracy}m)`);
            this.lastAccuracyLevel = accuracyLevel.level;
            
            // 精度が大幅に変化した場合は通知
            if (accuracyLevel.level === 'poor' && this.lastAccuracyLevel !== 'poor') {
                this.showWarning(`GPS精度が低下しました: ${accuracyLevel.recommendation}`);
            } else if (accuracyLevel.level === 'excellent' && this.lastAccuracyLevel === 'poor') {
                this.showInfo('GPS精度が改善されました');
            }
        }
    }
    
    /**
     * タイムスタンプを人間が読める形式にフォーマット
     * @param {Date} date 日付オブジェクト
     * @returns {string} フォーマットされた日時文字列
     */
    formatTimestamp(date) {
        const options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        };
        
        return date.toLocaleString('ja-JP', options);
    }
    
    /**
     * ステータス表示を更新
     * @param {string} text ステータステキスト
     * @param {string} type ステータスタイプ（loading, active, error）
     */
    updateStatus(text, type) {
        this.elements.statusText.textContent = text;
        
        // CSSクラスをリセット
        this.elements.statusIndicator.className = 'status-indicator';
        
        // 新しいクラスを追加
        if (type === 'active') {
            this.elements.statusIndicator.classList.add('active');
        } else if (type === 'error') {
            this.elements.statusIndicator.classList.add('error');
        }
    }
    
    /**
     * エラーメッセージを表示 - 要件1.3, 5.1, 5.2対応
     * @param {string} message エラーメッセージ
     * @param {string} type エラータイプ（'error', 'warning', 'info'）
     */
    showError(message, type = 'error') {
        const errorDiv = document.createElement('div');
        errorDiv.className = `error-item error-${type}`;
        
        // 改行文字を<br>タグに変換して複数行メッセージをサポート
        const formattedMessage = message.replace(/\n/g, '<br>');
        errorDiv.innerHTML = formattedMessage;
        
        // タイムスタンプを追加
        const timestamp = new Date().toLocaleTimeString('ja-JP');
        const timestampSpan = document.createElement('span');
        timestampSpan.className = 'error-timestamp';
        timestampSpan.textContent = `[${timestamp}]`;
        errorDiv.insertBefore(timestampSpan, errorDiv.firstChild);
        
        this.elements.errorMessages.appendChild(errorDiv);
        this.elements.errorMessages.classList.add('show');
        
        // エラーログを記録（詳細情報付き）
        console.error('GPS Tracker Error:', {
            message: message,
            type: type,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        });
        
        // エラーメッセージを自動的にスクロール表示
        this.elements.errorMessages.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest' 
        });
    }
    
    /**
     * 警告メッセージを表示
     * @param {string} message 警告メッセージ
     */
    showWarning(message) {
        this.showError(message, 'warning');
    }
    
    /**
     * 情報メッセージを表示
     * @param {string} message 情報メッセージ
     */
    showInfo(message) {
        this.showError(message, 'info');
    }
    
    /**
     * ネットワーク状態監視を設定 - 要件5.3対応
     */
    setupNetworkMonitoring() {
        // ネットワーク状態履歴を初期化
        this.networkHistory = [];
        this.networkStatusElement = null;
        
        // オンライン/オフライン状態の監視
        window.addEventListener('online', () => {
            console.log('Network connection restored');
            this.networkStatus.isOnline = true;
            this.networkStatus.lastCheck = Date.now();
            
            // ネットワーク復旧の記録
            this.recordNetworkEvent('online', 'ネットワーク接続が復旧しました');
            
            this.showInfo('ネットワーク接続が復旧しました。位置情報の取得を再開します。');
            this.updateNetworkStatusDisplay();
            
            // オフライン中に追跡が停止していた場合は再開
            if (!this.isTracking) {
                setTimeout(() => {
                    this.startTracking();
                }, 1000);
            }
            
            // 接続品質をテスト
            this.testNetworkQuality();
        });
        
        window.addEventListener('offline', () => {
            console.log('Network connection lost');
            this.networkStatus.isOnline = false;
            this.networkStatus.lastCheck = Date.now();
            
            // ネットワーク切断の記録
            this.recordNetworkEvent('offline', 'ネットワーク接続が失われました');
            
            this.showWarning('ネットワーク接続が失われました。GPS機能は制限される可能性があります。\n' +
                           '位置情報の精度が低下する場合があります。');
            this.updateStatus('オフライン', 'error');
            this.updateNetworkStatusDisplay();
        });
        
        // 定期的なネットワーク状態チェック（30秒間隔）
        this.networkCheckInterval = setInterval(() => {
            this.performNetworkHealthCheck();
        }, 30000);
        
        // 初期ネットワーク状態をチェック
        this.performInitialNetworkCheck();
        
        // ネットワーク状態表示要素を作成
        this.createNetworkStatusDisplay();
    }
    
    /**
     * 初期ネットワーク状態チェック - 要件5.3対応
     */
    performInitialNetworkCheck() {
        const isOnline = navigator.onLine;
        this.networkStatus.isOnline = isOnline;
        this.networkStatus.lastCheck = Date.now();
        
        if (!isOnline) {
            this.recordNetworkEvent('offline', '初期状態: オフライン');
            this.showWarning('現在オフラインです。ネットワーク接続を確認してください。');
            this.updateStatus('オフライン', 'error');
        } else {
            this.recordNetworkEvent('online', '初期状態: オンライン');
            // 接続品質をテスト
            this.testNetworkQuality();
        }
        
        this.updateNetworkStatusDisplay();
    }
    
    /**
     * ネットワーク品質をテスト - 要件5.3対応
     */
    async testNetworkQuality() {
        try {
            const startTime = Date.now();
            
            // 小さなリクエストでネットワーク応答時間を測定
            const response = await fetch('data:text/plain;base64,', {
                method: 'HEAD',
                cache: 'no-cache'
            });
            
            const responseTime = Date.now() - startTime;
            
            // ネットワーク品質を判定
            let quality = 'excellent';
            let qualityDescription = '優秀';
            
            if (responseTime > 2000) {
                quality = 'poor';
                qualityDescription = '低品質';
            } else if (responseTime > 1000) {
                quality = 'fair';
                qualityDescription = '普通';
            } else if (responseTime > 500) {
                quality = 'good';
                qualityDescription = '良好';
            }
            
            // ネットワーク品質情報を記録
            this.networkStatus.quality = quality;
            this.networkStatus.responseTime = responseTime;
            this.networkStatus.qualityDescription = qualityDescription;
            
            console.log(`Network quality test: ${quality} (${responseTime}ms)`);
            
            // 品質が低い場合は警告
            if (quality === 'poor') {
                this.showWarning(`ネットワーク接続が不安定です（応答時間: ${responseTime}ms）。\n` +
                               'GPS精度に影響する可能性があります。');
            }
            
        } catch (error) {
            console.warn('Network quality test failed:', error);
            this.networkStatus.quality = 'unknown';
            this.networkStatus.responseTime = null;
            this.networkStatus.qualityDescription = '不明';
        }
        
        this.updateNetworkStatusDisplay();
    }
    
    /**
     * 定期的なネットワーク健全性チェック - 要件5.3対応
     */
    performNetworkHealthCheck() {
        const currentOnlineStatus = navigator.onLine;
        const previousStatus = this.networkStatus.isOnline;
        
        // 状態変化を検出
        if (currentOnlineStatus !== previousStatus) {
            console.log(`Network status change detected: ${previousStatus} → ${currentOnlineStatus}`);
            
            this.networkStatus.isOnline = currentOnlineStatus;
            this.networkStatus.lastCheck = Date.now();
            
            if (currentOnlineStatus) {
                this.recordNetworkEvent('online', 'ネットワーク接続が復旧しました（定期チェック）');
                this.showInfo('ネットワーク接続が復旧しました。');
                this.testNetworkQuality();
            } else {
                this.recordNetworkEvent('offline', 'ネットワーク接続が失われました（定期チェック）');
                this.showWarning('ネットワーク接続が失われました。');
                this.updateStatus('オフライン', 'error');
            }
            
            this.updateNetworkStatusDisplay();
        } else if (currentOnlineStatus) {
            // オンライン状態の場合は品質をテスト
            this.testNetworkQuality();
        }
    }
    
    /**
     * ネットワークイベントを記録 - 要件5.3対応
     * @param {string} status ネットワーク状態（'online' | 'offline'）
     * @param {string} description イベントの説明
     */
    recordNetworkEvent(status, description) {
        const event = {
            status: status,
            description: description,
            timestamp: Date.now(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        this.networkHistory.push(event);
        
        // 履歴サイズを制限（最新20件のみ保持）
        const MAX_NETWORK_HISTORY = 20;
        if (this.networkHistory.length > MAX_NETWORK_HISTORY) {
            this.networkHistory.shift();
        }
        
        console.log('Network event recorded:', event);
    }
    
    /**
     * ネットワーク状態表示要素を作成 - 要件5.3対応
     */
    createNetworkStatusDisplay() {
        // ネットワーク状態表示要素を作成
        this.networkStatusElement = document.createElement('div');
        this.networkStatusElement.id = 'network-status-display';
        this.networkStatusElement.className = 'network-status-display';
        
        // ステータスセクションの後に挿入
        const statusSection = document.querySelector('.status-section');
        if (statusSection) {
            statusSection.parentNode.insertBefore(
                this.networkStatusElement, 
                statusSection.nextSibling
            );
        }
        
        this.updateNetworkStatusDisplay();
    }
    
    /**
     * ネットワーク状態表示を更新 - 要件5.3対応
     */
    updateNetworkStatusDisplay() {
        if (!this.networkStatusElement) {
            return;
        }
        
        const isOnline = this.networkStatus.isOnline;
        const quality = this.networkStatus.quality || 'unknown';
        const responseTime = this.networkStatus.responseTime;
        const qualityDescription = this.networkStatus.qualityDescription || '不明';
        
        // 表示内容を構築
        let statusIcon, statusText, statusClass, qualityInfo = '';
        
        if (isOnline) {
            statusIcon = '🌐';
            statusText = 'オンライン';
            statusClass = 'online';
            
            if (responseTime !== null) {
                qualityInfo = `
                    <div class="network-quality">
                        <span class="quality-label">接続品質:</span>
                        <span class="quality-value ${quality}">${qualityDescription}</span>
                        <span class="response-time">(${responseTime}ms)</span>
                    </div>
                `;
            }
        } else {
            statusIcon = '🚫';
            statusText = 'オフライン';
            statusClass = 'offline';
        }
        
        // 最終チェック時刻
        const lastCheckTime = new Date(this.networkStatus.lastCheck).toLocaleTimeString('ja-JP');
        
        // HTML内容を更新
        this.networkStatusElement.innerHTML = `
            <div class="network-status-header">
                <span class="network-icon">${statusIcon}</span>
                <span class="network-text">ネットワーク: ${statusText}</span>
            </div>
            ${qualityInfo}
            <div class="network-last-check">
                <small>最終確認: ${lastCheckTime}</small>
            </div>
        `;
        
        // CSSクラスを更新
        this.networkStatusElement.className = `network-status-display ${statusClass}`;
        
        // オフライン時は表示を目立たせる
        if (!isOnline) {
            this.networkStatusElement.style.display = 'block';
        } else if (quality === 'poor') {
            this.networkStatusElement.style.display = 'block';
        } else {
            // オンラインで品質が良好な場合は控えめに表示
            this.networkStatusElement.style.display = 'block';
        }
    }
    
    /**
     * ネットワーク監視を停止
     */
    stopNetworkMonitoring() {
        if (this.networkCheckInterval) {
            clearInterval(this.networkCheckInterval);
            this.networkCheckInterval = null;
        }
        
        // イベントリスナーを削除
        window.removeEventListener('online', this.handleOnline);
        window.removeEventListener('offline', this.handleOffline);
    }
    
    /**
     * ネットワーク状態をチェック
     * @returns {boolean} オンラインの場合はtrue
     */
    checkNetworkStatus() {
        const isOnline = navigator.onLine;
        const now = Date.now();
        
        // 状態が変化した場合のみログ出力
        if (isOnline !== this.networkStatus.isOnline) {
            console.log(`Network status changed: ${isOnline ? 'online' : 'offline'}`);
            this.networkStatus.isOnline = isOnline;
            this.networkStatus.lastCheck = now;
        }
        
        return isOnline;
    }
    
    /**
     * GPS信号強度を監視し、弱信号時の警告を表示 - 要件5.4対応
     * @param {number} accuracy 現在の精度値（メートル）
     * @param {number} timestamp 位置データのタイムスタンプ
     */
    monitorSignalStrength(accuracy, timestamp) {
        // 弱信号の閾値を定義
        const WEAK_SIGNAL_THRESHOLD = 200; // 200m以上は弱信号とみなす
        const VERY_WEAK_SIGNAL_THRESHOLD = 500; // 500m以上は非常に弱い信号
        
        // 信号強度レベルを判定
        let signalStrength = 'strong';
        let warningLevel = 'none';
        
        if (accuracy >= VERY_WEAK_SIGNAL_THRESHOLD) {
            signalStrength = 'very_weak';
            warningLevel = 'severe';
        } else if (accuracy >= WEAK_SIGNAL_THRESHOLD) {
            signalStrength = 'weak';
            warningLevel = 'moderate';
        } else if (accuracy >= 100) {
            signalStrength = 'fair';
            warningLevel = 'mild';
        }
        
        // 弱信号警告を表示
        this.displayWeakSignalWarning(signalStrength, accuracy, warningLevel);
        
        // 信号強度の履歴を記録（トレンド分析用）
        this.recordSignalStrengthHistory(accuracy, timestamp);
        
        // 連続的な弱信号の検出
        this.detectContinuousWeakSignal(accuracy, timestamp);
    }
    
    /**
     * 弱信号警告を表示 - 要件5.4対応
     * @param {string} signalStrength 信号強度レベル
     * @param {number} accuracy 精度値
     * @param {string} warningLevel 警告レベル
     */
    displayWeakSignalWarning(signalStrength, accuracy, warningLevel) {
        let warningElement = document.getElementById('weak-signal-warning');
        
        // 強い信号の場合は警告を非表示
        if (signalStrength === 'strong') {
            if (warningElement) {
                warningElement.style.display = 'none';
            }
            return;
        }
        
        // 警告要素を作成または取得
        if (!warningElement) {
            warningElement = document.createElement('div');
            warningElement.id = 'weak-signal-warning';
            warningElement.className = 'weak-signal-warning';
            
            // 精度表示セクションの後に挿入
            const locationSection = document.querySelector('.location-section');
            locationSection.parentNode.insertBefore(warningElement, locationSection.nextSibling);
        }
        
        // 警告レベルに応じたメッセージとスタイル
        let icon, title, message, recommendations, cssClass;
        
        switch (signalStrength) {
            case 'very_weak':
                icon = '📶❌';
                title = 'GPS信号が非常に弱い状態です';
                message = `現在の精度: ±${Math.round(accuracy)}m（非常に低精度）`;
                recommendations = [
                    '屋外の開けた場所に移動してください',
                    '建物や障害物から離れてください',
                    'WiFi接続を確認してください',
                    '端末を再起動することを検討してください'
                ];
                cssClass = 'severe';
                break;
            case 'weak':
                icon = '📶⚠️';
                title = 'GPS信号が弱い状態です';
                message = `現在の精度: ±${Math.round(accuracy)}m（低精度）`;
                recommendations = [
                    '屋外に移動するか窓の近くに移動してください',
                    '高い建物や地下から離れてください',
                    'しばらく待って信号の改善を待ってください'
                ];
                cssClass = 'moderate';
                break;
            case 'fair':
                icon = '📶⚡';
                title = 'GPS精度が制限されています';
                message = `現在の精度: ±${Math.round(accuracy)}m（中精度）`;
                recommendations = [
                    '位置情報は利用可能ですが精度が制限されています',
                    'より正確な位置が必要な場合は屋外に移動してください'
                ];
                cssClass = 'mild';
                break;
        }
        
        // 警告内容を更新
        warningElement.innerHTML = `
            <div class="weak-signal-header">
                <span class="signal-icon">${icon}</span>
                <span class="signal-title">${title}</span>
            </div>
            <div class="signal-accuracy">${message}</div>
            <div class="signal-recommendations">
                <div class="recommendations-title">改善方法:</div>
                <ul class="recommendations-list">
                    ${recommendations.map(rec => `<li>${rec}</li>`).join('')}
                </ul>
            </div>
            <div class="signal-timestamp">
                <small>最終更新: ${new Date().toLocaleTimeString('ja-JP')}</small>
            </div>
        `;
        
        // CSSクラスを更新
        warningElement.className = `weak-signal-warning ${cssClass}`;
        warningElement.style.display = 'block';
        
        // 警告レベルに応じてログ出力
        const logMessage = `Weak GPS signal detected: ${signalStrength} (±${Math.round(accuracy)}m)`;
        if (warningLevel === 'severe') {
            console.warn(logMessage);
        } else {
            console.log(logMessage);
        }
    }
    
    /**
     * 信号強度履歴を記録
     * @param {number} accuracy 精度値
     * @param {number} timestamp タイムスタンプ
     */
    recordSignalStrengthHistory(accuracy, timestamp) {
        // 信号強度履歴を初期化（存在しない場合）
        if (!this.signalStrengthHistory) {
            this.signalStrengthHistory = [];
        }
        
        // 新しい記録を追加
        this.signalStrengthHistory.push({
            accuracy: accuracy,
            timestamp: timestamp,
            signalStrength: this.classifySignalStrength(accuracy)
        });
        
        // 履歴サイズを制限（最新10件のみ保持）
        const MAX_HISTORY_SIZE = 10;
        if (this.signalStrengthHistory.length > MAX_HISTORY_SIZE) {
            this.signalStrengthHistory.shift();
        }
    }
    
    /**
     * 精度値から信号強度を分類
     * @param {number} accuracy 精度値
     * @returns {string} 信号強度レベル
     */
    classifySignalStrength(accuracy) {
        if (accuracy >= 500) return 'very_weak';
        if (accuracy >= 200) return 'weak';
        if (accuracy >= 100) return 'fair';
        if (accuracy >= 50) return 'good';
        return 'excellent';
    }
    
    /**
     * 連続的な弱信号を検出 - 要件5.4対応
     * @param {number} accuracy 現在の精度値
     * @param {number} timestamp 現在のタイムスタンプ
     */
    detectContinuousWeakSignal(accuracy, timestamp) {
        // 連続弱信号状態を初期化（存在しない場合）
        if (!this.continuousWeakSignal) {
            this.continuousWeakSignal = {
                isActive: false,
                startTime: null,
                duration: 0,
                count: 0
            };
        }
        
        const isWeakSignal = accuracy >= 200; // 200m以上を弱信号とみなす
        
        if (isWeakSignal) {
            if (!this.continuousWeakSignal.isActive) {
                // 弱信号状態の開始
                this.continuousWeakSignal.isActive = true;
                this.continuousWeakSignal.startTime = timestamp;
                this.continuousWeakSignal.count = 1;
            } else {
                // 弱信号状態の継続
                this.continuousWeakSignal.count++;
                this.continuousWeakSignal.duration = timestamp - this.continuousWeakSignal.startTime;
            }
            
            // 長時間の弱信号を検出した場合の追加警告
            const durationMinutes = this.continuousWeakSignal.duration / (1000 * 60);
            if (durationMinutes >= 2 && this.continuousWeakSignal.count >= 5) {
                this.showPersistentWeakSignalWarning(durationMinutes, this.continuousWeakSignal.count);
            }
        } else {
            // 信号が改善された場合
            if (this.continuousWeakSignal.isActive) {
                const durationMinutes = (timestamp - this.continuousWeakSignal.startTime) / (1000 * 60);
                console.log(`Weak signal period ended: ${durationMinutes.toFixed(1)} minutes, ${this.continuousWeakSignal.count} readings`);
                
                // 信号改善の通知
                if (durationMinutes >= 1) {
                    this.showInfo(`GPS信号が改善されました（弱信号期間: ${durationMinutes.toFixed(1)}分）`);
                }
                
                // 弱信号状態をリセット
                this.continuousWeakSignal.isActive = false;
                this.continuousWeakSignal.startTime = null;
                this.continuousWeakSignal.duration = 0;
                this.continuousWeakSignal.count = 0;
            }
        }
    }
    
    /**
     * 持続的な弱信号警告を表示
     * @param {number} durationMinutes 弱信号継続時間（分）
     * @param {number} count 弱信号読み取り回数
     */
    showPersistentWeakSignalWarning(durationMinutes, count) {
        // 重複警告を避けるため、最後の警告から1分以上経過している場合のみ表示
        if (!this.lastPersistentWarning || (Date.now() - this.lastPersistentWarning) >= 60000) {
            const warningMessage = `GPS信号が${durationMinutes.toFixed(1)}分間弱い状態が続いています（${count}回の読み取り）。\n` +
                                 '以下をお試しください：\n' +
                                 '• 屋外の開けた場所に移動\n' +
                                 '• 建物や障害物から離れる\n' +
                                 '• 端末の位置情報設定を確認\n' +
                                 '• WiFi接続を確認';
            
            this.showWarning(warningMessage);
            this.lastPersistentWarning = Date.now();
        }
    }
    
    /**
     * エラーメッセージをクリア
     */
    clearErrors() {
        this.elements.errorMessages.innerHTML = '';
        this.elements.errorMessages.classList.remove('show');
    }
    
    /**
     * セッションIDを生成 - 要件5.5対応
     * @returns {string} ユニークなセッションID
     */
    generateSessionId() {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `gps-${timestamp}-${random}`;
    }
    
    /**
     * 包括的なエラーログ機能 - 要件5.5対応
     * @param {string} level ログレベル（'error', 'warning', 'info', 'debug'）
     * @param {string} message エラーメッセージ
     * @param {Object} context 追加のコンテキスト情報
     * @param {Error} error エラーオブジェクト（オプション）
     */
    logError(level, message, context = {}, error = null) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            id: this.generateLogId(),
            sessionId: this.errorLogger.sessionId,
            timestamp: timestamp,
            level: level,
            message: message,
            context: {
                ...context,
                url: window.location.href,
                userAgent: navigator.userAgent,
                isTracking: this.isTracking,
                networkStatus: this.networkStatus,
                lastKnownPosition: this.lastKnownPosition ? {
                    latitude: this.lastKnownPosition.latitude,
                    longitude: this.lastKnownPosition.longitude,
                    accuracy: this.lastKnownPosition.accuracy,
                    timestamp: this.lastKnownPosition.timestamp
                } : null
            },
            stack: error ? error.stack : new Error().stack,
            errorDetails: error ? {
                name: error.name,
                message: error.message,
                code: error.code || null
            } : null
        };
        
        // ログエントリを保存
        this.errorLogger.logs.push(logEntry);
        
        // ログサイズを制限
        if (this.errorLogger.logs.length > this.errorLogger.maxLogs) {
            this.errorLogger.logs.shift();
        }
        
        // コンソールに出力
        this.outputToConsole(level, message, logEntry);
        
        // 重要なエラーの場合はユーザーフレンドリーメッセージを表示
        if (level === 'error') {
            this.displayUserFriendlyError(message, context, error);
        }
        
        // ローカルストレージに保存（オプション）
        this.saveLogsToStorage();
        
        return logEntry.id;
    }
    
    /**
     * ログIDを生成
     * @returns {string} ユニークなログID
     */
    generateLogId() {
        return `log-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    }
    
    /**
     * コンソールに適切なレベルで出力
     * @param {string} level ログレベル
     * @param {string} message メッセージ
     * @param {Object} logEntry ログエントリ
     */
    outputToConsole(level, message, logEntry) {
        const consoleMessage = `[GPS Tracker] ${message}`;
        
        switch (level) {
            case 'error':
                console.error(consoleMessage, logEntry);
                break;
            case 'warning':
                console.warn(consoleMessage, logEntry);
                break;
            case 'info':
                console.info(consoleMessage, logEntry);
                break;
            case 'debug':
                console.debug(consoleMessage, logEntry);
                break;
            default:
                console.log(consoleMessage, logEntry);
        }
    }
    
    /**
     * ユーザーフレンドリーなエラーメッセージを表示 - 要件5.5対応
     * @param {string} technicalMessage 技術的なエラーメッセージ
     * @param {Object} context コンテキスト情報
     * @param {Error} error エラーオブジェクト
     */
    displayUserFriendlyError(technicalMessage, context, error) {
        let userMessage = '';
        let suggestions = [];
        
        // エラーの種類に基づいてユーザーフレンドリーなメッセージを生成
        if (error && error.name === 'GeolocationPositionError') {
            // GPS関連のエラー
            switch (error.code) {
                case 1: // PERMISSION_DENIED
                    userMessage = '位置情報の使用が許可されていません';
                    suggestions = [
                        'ブラウザの設定で位置情報を許可してください',
                        'ページを再読み込みして再試行してください'
                    ];
                    break;
                case 2: // POSITION_UNAVAILABLE
                    userMessage = '位置情報を取得できません';
                    suggestions = [
                        '屋外に移動してください',
                        'WiFi接続を確認してください',
                        'しばらく待ってから再試行してください'
                    ];
                    break;
                case 3: // TIMEOUT
                    userMessage = '位置情報の取得がタイムアウトしました';
                    suggestions = [
                        'ネットワーク接続を確認してください',
                        'GPS信号の良い場所に移動してください'
                    ];
                    break;
            }
        } else if (technicalMessage.includes('network') || technicalMessage.includes('Network')) {
            // ネットワーク関連のエラー
            userMessage = 'ネットワーク接続に問題があります';
            suggestions = [
                'インターネット接続を確認してください',
                'WiFiまたはモバイルデータを確認してください',
                'しばらく待ってから再試行してください'
            ];
        } else if (technicalMessage.includes('permission') || technicalMessage.includes('Permission')) {
            // 許可関連のエラー
            userMessage = 'アプリケーションの許可設定に問題があります';
            suggestions = [
                'ブラウザの設定を確認してください',
                'ページを再読み込みしてください'
            ];
        } else {
            // 一般的な予期しないエラー
            userMessage = '予期しないエラーが発生しました';
            suggestions = [
                'ページを再読み込みしてください',
                'ブラウザを再起動してください',
                '問題が続く場合は、別のブラウザをお試しください'
            ];
        }
        
        // エラーレポートIDを生成
        const errorReportId = this.generateErrorReportId();
        
        // ユーザーフレンドリーなメッセージを構築
        let displayMessage = `${userMessage}\n\n`;
        
        if (suggestions.length > 0) {
            displayMessage += '解決方法:\n';
            suggestions.forEach((suggestion, index) => {
                displayMessage += `${index + 1}. ${suggestion}\n`;
            });
            displayMessage += '\n';
        }
        
        displayMessage += `エラーレポートID: ${errorReportId}\n`;
        displayMessage += '問題が続く場合は、このIDをお控えください。';
        
        // エラーメッセージを表示
        this.showError(displayMessage, 'error');
        
        // エラーレポートを記録
        this.recordErrorReport(errorReportId, technicalMessage, context, error);
    }
    
    /**
     * エラーレポートIDを生成
     * @returns {string} エラーレポートID
     */
    generateErrorReportId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 4).toUpperCase();
        return `ER-${timestamp}-${random}`;
    }
    
    /**
     * エラーレポートを記録
     * @param {string} reportId エラーレポートID
     * @param {string} technicalMessage 技術的なメッセージ
     * @param {Object} context コンテキスト
     * @param {Error} error エラーオブジェクト
     */
    recordErrorReport(reportId, technicalMessage, context, error) {
        const errorReport = {
            reportId: reportId,
            timestamp: new Date().toISOString(),
            sessionId: this.errorLogger.sessionId,
            technicalMessage: technicalMessage,
            context: context,
            error: error ? {
                name: error.name,
                message: error.message,
                code: error.code,
                stack: error.stack
            } : null,
            systemInfo: {
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                cookieEnabled: navigator.cookieEnabled,
                onLine: navigator.onLine,
                url: window.location.href,
                referrer: document.referrer,
                screenResolution: `${screen.width}x${screen.height}`,
                windowSize: `${window.innerWidth}x${window.innerHeight}`
            },
            appState: {
                isTracking: this.isTracking,
                watchId: this.watchId,
                positionHistoryLength: this.positionHistory.length,
                errorStateActive: this.errorState.hasError,
                networkOnline: this.networkStatus.isOnline,
                lastKnownPosition: this.lastKnownPosition ? 'available' : 'none'
            }
        };
        
        // エラーレポートをローカルストレージに保存
        try {
            const existingReports = JSON.parse(localStorage.getItem('gps-tracker-error-reports') || '[]');
            existingReports.push(errorReport);
            
            // 最新10件のみ保持
            if (existingReports.length > 10) {
                existingReports.splice(0, existingReports.length - 10);
            }
            
            localStorage.setItem('gps-tracker-error-reports', JSON.stringify(existingReports));
        } catch (storageError) {
            console.warn('Failed to save error report to localStorage:', storageError);
        }
        
        console.error('Error Report Generated:', errorReport);
    }
    
    /**
     * ログをローカルストレージに保存
     */
    saveLogsToStorage() {
        try {
            // 最新50件のログのみ保存
            const logsToSave = this.errorLogger.logs.slice(-50);
            localStorage.setItem('gps-tracker-logs', JSON.stringify(logsToSave));
        } catch (error) {
            console.warn('Failed to save logs to localStorage:', error);
        }
    }
    
    /**
     * ローカルストレージからログを読み込み
     */
    loadLogsFromStorage() {
        try {
            const savedLogs = localStorage.getItem('gps-tracker-logs');
            if (savedLogs) {
                const logs = JSON.parse(savedLogs);
                this.errorLogger.logs = [...logs, ...this.errorLogger.logs];
                
                // 重複を除去し、サイズを制限
                this.errorLogger.logs = this.errorLogger.logs
                    .filter((log, index, self) => 
                        index === self.findIndex(l => l.id === log.id)
                    )
                    .slice(-this.errorLogger.maxLogs);
            }
        } catch (error) {
            console.warn('Failed to load logs from localStorage:', error);
        }
    }
    
    /**
     * 予期しないエラーをキャッチして処理 - 要件5.5対応
     * @param {Error} error エラーオブジェクト
     * @param {string} context エラーが発生したコンテキスト
     */
    handleUnexpectedError(error, context = 'unknown') {
        const errorMessage = `Unexpected error in ${context}: ${error.message}`;
        
        this.logError('error', errorMessage, {
            context: context,
            errorName: error.name,
            errorCode: error.code || null
        }, error);
        
        // アプリケーションの状態を安全な状態に復旧を試行
        this.attemptErrorRecovery(error, context);
    }
    
    /**
     * エラーからの復旧を試行 - 要件5.5対応
     * @param {Error} error エラーオブジェクト
     * @param {string} context エラーコンテキスト
     */
    attemptErrorRecovery(error, context) {
        console.log(`Attempting error recovery for context: ${context}`);
        
        try {
            switch (context) {
                case 'position_tracking':
                    // 位置追跡エラーからの復旧
                    if (this.isTracking) {
                        console.log('Attempting to restart position tracking...');
                        setTimeout(() => {
                            this.stopTracking();
                            setTimeout(() => {
                                this.startTracking();
                            }, 2000);
                        }, 1000);
                    }
                    break;
                    
                case 'network_monitoring':
                    // ネットワーク監視エラーからの復旧
                    console.log('Attempting to restart network monitoring...');
                    this.stopNetworkMonitoring();
                    setTimeout(() => {
                        this.setupNetworkMonitoring();
                    }, 3000);
                    break;
                    
                case 'ui_update':
                    // UI更新エラーからの復旧
                    console.log('Attempting to recover UI state...');
                    this.updateStatus('復旧中...', 'loading');
                    break;
                    
                default:
                    // 一般的な復旧処理
                    console.log('Performing general error recovery...');
                    this.updateStatus('エラー復旧中...', 'loading');
                    break;
            }
            
            this.logError('info', `Error recovery attempted for ${context}`, {
                context: context,
                recoveryAction: 'attempted'
            });
            
        } catch (recoveryError) {
            this.logError('error', `Error recovery failed for ${context}`, {
                context: context,
                originalError: error.message,
                recoveryError: recoveryError.message
            }, recoveryError);
        }
    }
    
    /**
     * ログ統計を取得
     * @returns {Object} ログ統計情報
     */
    getLogStatistics() {
        const stats = {
            totalLogs: this.errorLogger.logs.length,
            byLevel: {},
            recentErrors: 0,
            sessionId: this.errorLogger.sessionId
        };
        
        // レベル別統計
        this.errorLogger.logLevels.forEach(level => {
            stats.byLevel[level] = this.errorLogger.logs.filter(log => log.level === level).length;
        });
        
        // 過去1時間のエラー数
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        stats.recentErrors = this.errorLogger.logs.filter(log => 
            log.level === 'error' && new Date(log.timestamp).getTime() > oneHourAgo
        ).length;
        
        return stats;
    }
}

// アプリケーション開始
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, starting GPS Tracker...');
    window.gpsTracker = new LocationTracker();
});

// エクスポート（テスト用）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LocationTracker };
}