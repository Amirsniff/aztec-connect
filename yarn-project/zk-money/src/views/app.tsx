import { AztecSdk } from '@aztec/sdk';
import { Navbar } from '../ui-components/index.js';
import { BroadcastChannel } from 'broadcast-channel';
import { PureComponent } from 'react';
import type { CutdownAsset } from '../app/types.js';
import { AppContext } from '../alt-model/app_context.js';
import {
  AccountState,
  App,
  AppAction,
  AppEvent,
  ShieldFormValues,
  LoginMode,
  LoginState,
  LoginStep,
  Provider,
  WalletId,
  WorldState,
} from '../app/index.js';
import { ProviderState } from '../app/provider.js';
import { Template } from '../components/index.js';
import { Config } from '../config.js';
import { Theme } from '../styles/index.js';
import { Home } from '../views/home.js';
import { Login } from '../views/login/index.js';
import { getActionFromUrl, getLoginModeFromUrl, getUrlFromAction, getUrlFromLoginMode, Pages } from './views.js';
import { UserAccount } from '../components/template/user_account.js';
import { NavigateFunction, Route, Routes } from 'react-router-dom';
import { SdkObs } from '../alt-model/top_level_context/sdk_obs.js';
import { ToastsObs } from '../alt-model/top_level_context/toasts_obs.js';
import { TransitionGroup, CSSTransition } from 'react-transition-group';
import { Balance } from './account/dashboard/balance.js';
import { Earn } from './account/dashboard/earn.js';
import { Trade } from './account/dashboard/trade.js';
import { Toasts } from './toasts/index.js';
import { DefiRecipe, FlowDirection } from '../alt-model/defi/types.js';
import { DefiModal } from '../views/account/dashboard/modals/defi_modal/index.js';
import { KNOWN_MAINNET_ASSET_ADDRESSES } from '../alt-model/known_assets/known_asset_addresses.js';
import { AccountStateProvider } from '../alt-model/account_state/index.js';
import './app.css';

interface AppProps {
  config: Config;
  sdkObs: SdkObs;
  toastsObs: ToastsObs;
  path: string;
  navigate: NavigateFunction;
}

interface AppState {
  action: AppAction;
  activeDefiModal?: { recipe: DefiRecipe; flowDirection: FlowDirection };
  loginState: LoginState;
  worldState: WorldState;
  providerState?: ProviderState;
  accountState?: AccountState;
  shieldForAliasForm?: ShieldFormValues;
  isLoading: boolean;
  sdk?: AztecSdk | undefined;
  provider?: Provider | undefined;
  path: string;
}

enum CrossTabEvent {
  LOGGED_IN = 'CROSS_TAB_LOGGED_IN',
  LOGGED_OUT = 'CROSS_TAB_LOGGED_OUT',
}

const LEGACY_APP_ASSETS: CutdownAsset[] = [
  {
    id: 0,
    symbol: 'ETH',
    address: KNOWN_MAINNET_ASSET_ADDRESSES.ETH,
    decimals: 18,
  },
];

export class AppView extends PureComponent<AppProps, AppState> {
  private app: App;
  private channel = new BroadcastChannel('zk-money');

  constructor(props: AppProps) {
    super(props);

    const { path, config } = props;
    const initialAction = getActionFromUrl(path);

    const loginMode = getLoginModeFromUrl(path);

    this.app = new App(config, LEGACY_APP_ASSETS, props.sdkObs, props.toastsObs, loginMode);

    this.state = {
      action: initialAction,
      loginState: this.app.loginState,
      worldState: this.app.worldState,
      providerState: this.app.providerState,
      accountState: this.app.accountState,
      shieldForAliasForm: this.app.shieldForAliasForm,
      activeDefiModal: undefined,
      // path will be removed once we are able to add router to ui-components
      path: '/',
      isLoading: true,
    };
  }

  async componentDidMount() {
    this.app.on(AppEvent.SESSION_CLOSED, () => {
      this.onSessionClosed();
      this.channel.postMessage({ name: CrossTabEvent.LOGGED_OUT });
    });
    this.app.on(AppEvent.SESSION_OPEN, () => this.channel.postMessage({ name: CrossTabEvent.LOGGED_IN }));
    this.app.on(AppEvent.UPDATED_LOGIN_STATE, this.onLoginStateChange);
    this.app.on(AppEvent.UPDATED_USER_SESSION_DATA, this.onUserSessionDataChange);
    this.channel.onmessage = async (msg: any) => {
      switch (msg.name) {
        case CrossTabEvent.LOGGED_IN:
          this.goToAction(AppAction.ACCOUNT);
          break;
        case CrossTabEvent.LOGGED_OUT:
          this.handleLogout();
          break;
      }
    };
    await this.handleActionChange(this.state.action);
    this.setState({ isLoading: false });
  }

  componentDidUpdate(prevProps: AppProps, prevState: AppState) {
    const { path: prevPath } = prevProps;
    const { path } = this.props;
    const { action: prevAction } = prevState;
    const { action } = this.state;
    if (path !== prevPath) {
      this.handleUrlChange(path);
    }
    if (action !== prevAction) {
      this.handleActionChange(action);
    }
  }

  componentWillUnmount() {
    this.app.destroy();
    this.channel.close();
  }

  private goToAction = (action: AppAction) => {
    if (action === this.state.action) {
      return;
    }
    if (action === AppAction.ACCOUNT) {
      if (window.location.pathname === Pages.SIGNIN || window.location.pathname === Pages.SIGNUP) {
        setTimeout(() => this.props.navigate(Pages.BALANCE), 0);
      }
    } else {
      const url = getUrlFromAction(action);
      if (window.location.pathname === Pages.BALANCE) {
        setTimeout(() => this.props.navigate(url), 0);
      }
    }
  };

  private cleanSystemMessage = () => {
    this.props.toastsObs.removeToastByKey('system-message');
  };

  private handleUrlChange = async (path: string) => {
    const action = getActionFromUrl(path);
    this.cleanSystemMessage();
    this.setState({ action });

    switch (action) {
      case AppAction.LOGIN: {
        const loginMode = getLoginModeFromUrl(path);
        this.app.changeLoginMode(loginMode);
        break;
      }
      default:
    }
  };

  private async handleActionChange(action: AppAction) {
    if (action === AppAction.ACCOUNT) {
      if (!this.app.hasSession()) {
        if (this.app.hasCookie()) {
          this.app.backgroundLogin();
        } else {
          this.goToAction(AppAction.LOGIN);
        }
      }
    } else if (this.app.hasCookie()) {
      this.goToAction(AppAction.ACCOUNT);
    }
  }

  private onLoginStateChange = (loginState: LoginState) => {
    if (loginState.step === LoginStep.DONE) {
      this.setState({ loginState }, () => this.goToAction(AppAction.ACCOUNT));
    } else {
      const callback =
        loginState.step === LoginStep.INIT_ACCOUNT && this.state.loginState.step !== LoginStep.INIT_ACCOUNT
          ? this.app.initAccount
          : undefined;
      this.setState({ loginState }, callback);
    }
  };

  private onUserSessionDataChange = () => {
    this.setState({
      loginState: this.app.loginState,
      providerState: this.app.providerState,
      worldState: this.app.worldState,
      accountState: this.app.accountState,
      shieldForAliasForm: this.app.shieldForAliasForm,
      sdk: this.app.sdk,
      provider: this.app.provider,
    });
  };

  private onSessionClosed = () => {
    const { action } = this.state;
    if (action === AppAction.ACCOUNT) {
      this.goToAction(AppAction.LOGIN);
    }
    this.onUserSessionDataChange();
  };

  private handleSignup = () => {
    const url = getUrlFromLoginMode(LoginMode.SIGNUP);
    this.props.navigate(url);
  };

  private handleConnectWallet = (walletId: WalletId) => {
    if (!this.app.hasSession()) {
      this.app.createSession();
    }
    this.app.connectWallet(walletId);
  };

  private handleRestart = () => {
    this.cleanSystemMessage();
    this.app.logout();
  };

  private handleOpenDefiEnterModal = (recipe: DefiRecipe) => {
    this.setState({ activeDefiModal: { recipe, flowDirection: 'enter' } });
  };

  private handleOpenDefiExitModal = (recipe: DefiRecipe) => {
    this.setState({ activeDefiModal: { recipe, flowDirection: 'exit' } });
  };

  private handleLogout = () => {
    if (!this.app.hasSession()) {
      return;
    }
    this.cleanSystemMessage();
    this.app.logout();
  };

  private getTheme = () => {
    if (
      window.location.pathname === Pages.HOME ||
      window.location.pathname === Pages.SIGNIN ||
      window.location.pathname === Pages.SIGNUP
    ) {
      return Theme.GRADIENT;
    }

    return Theme.WHITE;
  };

  render() {
    const {
      action,
      accountState,
      loginState,
      providerState,
      worldState,
      shieldForAliasForm,
      isLoading,
      activeDefiModal,
    } = this.state;
    const { config, toastsObs } = this.props;
    const { step } = loginState;

    const isShowingSystemMessage = toastsObs.hasSystemMessage();
    const isShowingSystemError = toastsObs.hasSystemError();
    const theme = this.getTheme();
    const processingAction = this.app.isProcessingAction();
    const allowReset = action !== AppAction.ACCOUNT && (!processingAction || isShowingSystemError);
    const isLoggedIn = step === LoginStep.DONE;

    const shouldCenterContent =
      window.location.pathname === Pages.TRADE ||
      window.location.pathname === Pages.SIGNUP ||
      window.location.pathname === Pages.SIGNIN;

    const accountComponent = isLoggedIn ? (
      <UserAccount account={accountState!} onLogout={this.handleLogout} />
    ) : undefined;

    return (
      <Template theme={theme} isLoading={isLoading} explorerUrl={config.explorerUrl}>
        <AppContext.Provider
          value={{
            config,
            requiredNetwork: this.app.requiredNetwork,
            provider: this.state.provider,
            userId: this.state.accountState?.userId,
            alias: this.state.accountState?.alias,
            keyVault: this.app.keyVault,
            db: this.app.db,
            rollupService: this.app.rollupService,
            userSession: this.app.getSession(),
          }}
        >
          <AccountStateProvider userId={this.state.accountState?.userId}>
            <Navbar
              path={window.location.pathname}
              theme={theme}
              isLoggingIn={loginState.isPerformingBackgroundLogin}
              isLoggedIn={isLoggedIn}
              accountComponent={accountComponent}
            />
            <TransitionGroup
              style={{
                margin: shouldCenterContent ? 'auto 0 auto 0' : 'initial',
                maxWidth: window.location.pathname === '/' ? 'initial' : 'calc(1350px + 20%)',
                alignSelf: 'center',
                width: '100%',
                padding: window.location.pathname === '/' ? 'initial' : '0 10%',
              }}
            >
              <CSSTransition key={window.location.pathname} classNames="fade" timeout={250}>
                <Routes location={window.location.pathname}>
                  {[Pages.SIGNUP, Pages.SIGNIN].map((path: string) => (
                    <Route
                      key={path}
                      path={path}
                      element={
                        <Login
                          worldState={worldState}
                          loginState={loginState}
                          providerState={providerState}
                          availableWallets={this.app.availableWallets}
                          shieldForAliasForm={shieldForAliasForm}
                          explorerUrl={config.explorerUrl}
                          setAlias={this.app.setAlias}
                          isShowingSystemMessage={isShowingSystemMessage}
                          isShowingSystemError={isShowingSystemError}
                          onSelectWallet={this.handleConnectWallet}
                          onSelectAlias={this.app.confirmAlias}
                          onRestart={allowReset && step !== LoginStep.CONNECT_WALLET ? this.handleRestart : undefined}
                          onShieldForAliasFormInputsChange={this.app.changeShieldForAliasForm}
                          onSubmitShieldForAliasForm={this.app.claimUserName}
                          onChangeWallet={this.app.changeWallet}
                        />
                      }
                    />
                  ))}
                  <Route
                    path={Pages.EARN}
                    element={
                      <Earn
                        isLoggedIn={isLoggedIn}
                        onOpenDefiEnterModal={this.handleOpenDefiEnterModal}
                        onOpenDefiExitModal={this.handleOpenDefiExitModal}
                      />
                    }
                  />
                  <Route path={Pages.TRADE} element={<Trade />} />
                  <Route
                    path={Pages.BALANCE}
                    element={<Balance onOpenDefiExitModal={this.handleOpenDefiExitModal} />}
                  />
                  <Route path={Pages.HOME} element={<Home onSignup={this.handleSignup} />} />
                </Routes>
              </CSSTransition>
            </TransitionGroup>
            {activeDefiModal && (
              <DefiModal onClose={() => this.setState({ activeDefiModal: undefined })} {...activeDefiModal} />
            )}
            <Toasts />
          </AccountStateProvider>
        </AppContext.Provider>
      </Template>
    );
  }
}