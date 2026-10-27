import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAnalytics } from "firebase/analytics";
import { getFunctions } from "firebase/functions";

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyDUDBV8Q-H5JpZZfCtQiKq_lsuAVCJu8ek",
    authDomain: "mylms-c74a7.firebaseapp.com",
    projectId: "mylms-c74a7",
    storageBucket: "mylms-c74a7.firebasestorage.app",
    messagingSenderId: "123389174928",
    appId: "1:123389174928:web:60fc60c55a7f3d90d2e415",
    measurementId: "G-T29G1BW0S4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, "us-central1");
export const analytics = typeof window !== "undefined" ? getAnalytics(app) : null;

export default app;
