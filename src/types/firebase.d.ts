declare module 'firebase/app' {
  export interface FirebaseApp {}
  export function getApps(): FirebaseApp[];
  export function initializeApp(options: { apiKey: string; [key: string]: unknown }): FirebaseApp;
}

declare module 'firebase/auth' {
  export interface User {
    uid: string;
    email: string | null;
    emailVerified: boolean;
    getIdToken(forceRefresh?: boolean): Promise<string>;
  }
  export interface Auth {
    currentUser: User | null;
  }
  export function getAuth(app?: import('firebase/app').FirebaseApp): Auth;
  export function signInWithEmailAndPassword(auth: Auth, email: string, password: string): Promise<{ user: User }>;
  export function createUserWithEmailAndPassword(auth: Auth, email: string, password: string): Promise<{ user: User }>;
  export function sendPasswordResetEmail(auth: Auth, email: string): Promise<void>;
  export function sendEmailVerification(user: User): Promise<void>;
  export function signOut(auth: Auth): Promise<void>;
  export function onAuthStateChanged(auth: Auth, callback: (user: User | null) => void): () => void;
}

declare module 'firebase/firestore' {
  export interface Firestore {}
  export interface Timestamp {
    toDate(): Date;
  }
  export const Timestamp: { now(): Timestamp; fromDate(date: Date): Timestamp };
  export function serverTimestamp(): any;
  export function getFirestore(app?: import('firebase/app').FirebaseApp): Firestore;
  export function collection(db: Firestore, path: string): any;
  export function query(...args: any[]): any;
  export function where(field: string, op: string, value: any): any;
  export function orderBy(field: string, direction?: string): any;
  export interface QuerySnapshot<T = any> { forEach(cb: (doc: QueryDocumentSnapshot<T>) => void): void; }
  export function onSnapshot(query: any, next: (snap: QuerySnapshot) => void, error?: (err: Error) => void): () => void;
  export function enableNetwork(db: Firestore): Promise<void>;
  export function addDoc(ref: any, data: any): Promise<{ id: string }>;
  export function updateDoc(ref: any, data: any): Promise<void>;
  export function deleteDoc(ref: any): Promise<void>;
  export function doc(db: Firestore, path: string, id?: string): any;
  export type DocumentData = Record<string, any>;
  export interface QueryDocumentSnapshot<T = any> { id: string; data(): T; }
}