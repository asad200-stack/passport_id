/**
 * Firebase config for this app.
 * Used to auto-fill the bgremoverfree Proxy URL (Firebase Function).
 * For Analytics or other SDKs, add initializeApp(firebaseConfig) in your app.
 */
(function () {
  "use strict";

  var firebaseConfig = {
    apiKey: "AIzaSyDA-aHo6b-ZtXNyFCTG6D7bY6MExum0H5s",
    authDomain: "passport-id-johnycreator.firebaseapp.com",
    projectId: "passport-id-johnycreator",
    storageBucket: "passport-id-johnycreator.firebasestorage.app",
    messagingSenderId: "623395203619",
    appId: "1:623395203619:web:ec0a0dbbbe85afe0b1df96",
    measurementId: "G-EW1C299YDL",
  };

  window.FIREBASE_CONFIG = firebaseConfig;
  // Proxy URL for Free 100/day — deploy with: firebase deploy --only functions
  window.FIREBASE_PROXY_URL =
    "https://us-central1-" + firebaseConfig.projectId + ".cloudfunctions.net/bgremoverfreeProxy";
})();
