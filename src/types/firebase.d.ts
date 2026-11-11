declare module 'firebase/app' {
  export interface FirebaseApp {}
  export function getApps(): FirebaseApp[];
  export function initializeApp(options: { apiKey: string; [key: string]: any }): FirebaseApp;
}

declare module 'firebase/auth' {
  export interface User {
    uid: string;
    email: string | null;
    [key: string]: any;
  }
  export interface Auth {}
  export function getAuth(app?: FirebaseApp): Auth;
  export function signInWithEmailAndPassword(auth: Auth, email: string, password: string): Promise<any>;
  export function createUserWithEmailAndPassword(auth: Auth, email: string, password: string): Promise<any>;
  export function signOut(auth: Auth): Promise<void>;
  export function onAuthStateChanged(auth: Auth, callback: (user: User | null) => void): () => void;
}

declare module 'firebase/firestore' {
  export interface Firestore {}
  export function getFirestore(app?: FirebaseApp): Firestore;
  export function collection(db: Firestore, path: string): any;
  export function query(...args: any[]): any;
  export function where(field: string, op: string, value: any): any;
  export function orderBy(field: string, direction?: string): any;
  export function onSnapshot(query: any, next: (snap: any) => void, error?: (err: any) => void): () => void;
  export function addDoc(ref: any, data: any): Promise<any>;
  export function updateDoc(ref: any, data: any): Promise<void>;
  export function deleteDoc(ref: any): Promise<void>;
  export function doc(db: Firestore, path: string, id?: string): any;
  export type DocumentData = any;
  export type QueryDocumentSnapshot<T = DocumentData> = T & { id: string };
}

declare module 'firebase/config' {
  export interface FirebaseOptions {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId: string;
  }
}