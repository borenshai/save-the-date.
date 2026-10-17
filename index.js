import { registerRootComponent } from 'expo';
import notifee from '@notifee/react-native';
import App from './App';

// Required by notifee so events while the app is closed are handled quietly.
notifee.onBackgroundEvent(async () => {});

registerRootComponent(App);
