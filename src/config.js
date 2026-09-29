import { NativeModules } from 'react-native';

const metroURL = NativeModules.SourceCode?.scriptURL || '';
const metroHost = metroURL.match(/^https?:\/\/([^/:?#]+)/)?.[1];
const apiHost =
	metroHost && !['localhost', '127.0.0.1', '0.0.0.0'].includes(metroHost)
		? metroHost
		: 'localhost';

// Use the Metro host during local development; production needs its HTTPS API URL.
export const API_URL = __DEV__
	? `http://${apiHost}:4000`
	: 'http://localhost:4000';
