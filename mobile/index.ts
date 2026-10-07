import { registerRootComponent } from 'expo';

// Ensure TaskManager task definitions and background managers are initialized at root module load
import './src/services/UpdateService';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
