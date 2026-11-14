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

  // serverTimestamp() возвращает специальный маркер, а не произвольное значение.
  // Присваивание результата в переменную с несовместимым типом будет ошибкой tsc.
  export interface ServerTimestamp {
    __serverTimestamp: true;
  }
  export function serverTimestamp(): ServerTimestamp;

  export interface DocumentReference<T = DocumentData> {
    id: string;
  }
  export interface CollectionReference<T = DocumentData> {
    id: string;
  }
  export interface QueryDocumentSnapshot<T = DocumentData> {
    id: string;
    data(): T;
  }
  export interface QuerySnapshot<T = DocumentData> {
    forEach(cb: (doc: QueryDocumentSnapshot<T>) => void): void;
  }

  export function getFirestore(app?: import('firebase/app').FirebaseApp): Firestore;
  export function collection(
    db: Firestore,
    path: string,
    ...pathComponents: string[]
  ): CollectionReference;
  export function doc<T = DocumentData>(
    db: Firestore,
    path: string,
    ...pathComponents: string[]
  ): DocumentReference<T>;
  type WhereFilterOp = '<' | '<=' | '==' | '>=' | '>' | 'array-contains' | 'in' | 'array-contains-any';
  type OrderByDirection = 'asc' | 'desc';

  export interface QueryConstraint {
    type: 'where' | 'orderBy' | 'limit' | 'limitToLast' | 'startAt' | 'startAfter' | 'endAt' | 'endBefore';
  }
  export interface Query<T = DocumentData> {}

  export function query(ref: CollectionReference | DocumentReference, ...constraints: QueryConstraint[]): Query;
  export function where(field: string, op: WhereFilterOp, value: any): QueryConstraint;
  export function orderBy(field: string, direction?: OrderByDirection): QueryConstraint;
  export function onSnapshot(
    query: Query,
    next: (snap: QuerySnapshot) => void,
    error?: (err: Error) => void,
  ): () => void;
  export function enableNetwork(db: Firestore): Promise<void>;
  export function addDoc(ref: CollectionReference, data: DocumentData): Promise<DocumentReference>;
  export function updateDoc(ref: DocumentReference, data: Partial<DocumentData>): Promise<void>;
  export function deleteDoc(ref: DocumentReference): Promise<void>;
  export type DocumentData = Record<string, any>;
}