import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    Timestamp,
    addDoc,
    orderBy,
    onSnapshot,
    serverTimestamp
} from "firebase/firestore";
import { db } from "./firebase";

// User Profile Operations
export const updateUserProfile = async (uid: string, data: any) => {
    const userRef = doc(db, "users", uid);
    await updateDoc(userRef, {
        ...data,
        updatedAt: Timestamp.now()
    });
};

// Course Operations
export const getCourses = async () => {
    const coursesCol = collection(db, "courses");
    const snapshot = await getDocs(coursesCol);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getInstructorCourses = async (instructorId: string) => {
    const coursesCol = collection(db, "courses");
    const q = query(coursesCol, where("instructorId", "==", instructorId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const createCourse = async (courseData: any) => {
    const coursesCol = collection(db, "courses");
    const docRef = await addDoc(coursesCol, {
        ...courseData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
    });
    return docRef.id;
};

// Enrollment Operations
export const enrollInCourse = async (studentId: string, courseId: string, instructorId: string, courseData: any) => {
    const enrollmentRef = doc(db, "enrollments", `${studentId}_${courseId}`);
    await setDoc(enrollmentRef, {
        studentId,
        courseId,
        instructorId,
        courseTitle: courseData.title,
        courseThumbnail: courseData.thumbnail,
        instructorName: courseData.instructorName,
        progress: 0,
        enrolledAt: Timestamp.now()
    });
};

export const getStudentEnrollments = async (studentId: string) => {
    const enrollmentsCol = collection(db, "enrollments");
    const q = query(enrollmentsCol, where("studentId", "==", studentId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getInstructorEnrollments = async (instructorId: string) => {
    const enrollmentsCol = collection(db, "enrollments");
    const q = query(enrollmentsCol, where("instructorId", "==", instructorId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getCourseEnrollments = async (courseId: string) => {
    const enrollmentsCol = collection(db, "enrollments");
    const q = query(enrollmentsCol, where("courseId", "==", courseId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getAllUsers = async () => {
    const usersCol = collection(db, "users");
    const snapshot = await getDocs(usersCol);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// ──────────────────────────────────────────────────
// Messaging Operations
// ──────────────────────────────────────────────────

// Get or create a conversation between two users
export const getOrCreateConversation = async (
    userId: string,
    otherUserId: string,
    otherUserName: string,
    currentUserName: string
) => {
    // Check if conversation already exists
    const convCol = collection(db, "conversations");
    const q = query(convCol, where("memberIds", "array-contains", userId));
    const snapshot = await getDocs(q);

    for (const convDoc of snapshot.docs) {
        const data = convDoc.data();
        if (data.memberIds.includes(otherUserId)) {
            return { id: convDoc.id, ...data };
        }
    }

    // Create a new conversation
    const newConv = await addDoc(convCol, {
        memberIds: [userId, otherUserId],
        members: {
            [userId]: { name: currentUserName },
            [otherUserId]: { name: otherUserName },
        },
        lastMessage: "",
        lastMessageAt: Timestamp.now(),
        createdAt: Timestamp.now(),
    });

    return { id: newConv.id, memberIds: [userId, otherUserId], members: { [userId]: { name: currentUserName }, [otherUserId]: { name: otherUserName } }, lastMessage: "", lastMessageAt: Timestamp.now() };
};

// Real-time listener for conversations
export const subscribeToConversations = (
    userId: string,
    callback: (conversations: any[]) => void
) => {
    const convCol = collection(db, "conversations");
    // Use a simple query without orderBy to avoid needing a composite index
    const q = query(
        convCol,
        where("memberIds", "array-contains", userId)
    );

    return onSnapshot(q, (snapshot) => {
        const conversations = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        // Sort client-side by lastMessageAt descending
        conversations.sort((a: any, b: any) => {
            const timeA = a.lastMessageAt?.toMillis?.() || 0;
            const timeB = b.lastMessageAt?.toMillis?.() || 0;
            return timeB - timeA;
        });
        callback(conversations);
    }, (error) => {
        console.error("Error subscribing to conversations:", error);
        callback([]);
    });
};

// Real-time listener for messages in a conversation
export const subscribeToMessages = (
    conversationId: string,
    callback: (messages: any[]) => void
) => {
    const messagesCol = collection(db, "conversations", conversationId, "messages");
    const q = query(messagesCol, orderBy("createdAt", "asc"));

    return onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        callback(messages);
    });
};

// Send a message
export const sendMessage = async (
    conversationId: string,
    senderId: string,
    senderName: string,
    text: string
) => {
    const messagesCol = collection(db, "conversations", conversationId, "messages");
    await addDoc(messagesCol, {
        senderId,
        senderName,
        text,
        createdAt: Timestamp.now(),
    });

    // Update conversation with last message
    const convRef = doc(db, "conversations", conversationId);
    await updateDoc(convRef, {
        lastMessage: text,
        lastMessageAt: Timestamp.now(),
    });
};

// ──────────────────────────────────────────────────
// Payment Operations
// ──────────────────────────────────────────────────

export interface PaymentData {
    userId: string;
    userName: string;
    email: string;
    paymentType: "one_on_one" | "monthly";
    amount: number; // in kobo
    currency: string;
    reference: string;
    status: "pending" | "completed" | "failed" | "cancelled";
    paystackData?: any;
}

export const createPayment = async (paymentData: PaymentData) => {
    const paymentsCol = collection(db, "payments");
    const docRef = await addDoc(paymentsCol, {
        ...paymentData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    });
    return docRef.id;
};

export const updatePaymentStatus = async (
    paymentId: string,
    status: string,
    paystackData?: any
) => {
    const paymentRef = doc(db, "payments", paymentId);
    const updateData: any = {
        status,
        updatedAt: Timestamp.now(),
    };
    if (paystackData) {
        updateData.paystackData = paystackData;
    }
    await updateDoc(paymentRef, updateData);
};

export const getUserPayments = async (userId: string) => {
    const paymentsCol = collection(db, "payments");
    const q = query(paymentsCol, where("userId", "==", userId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getPaymentByReference = async (reference: string) => {
    const paymentsCol = collection(db, "payments");
    const q = query(paymentsCol, where("reference", "==", reference));
    const snapshot = await getDocs(q);
    if (snapshot.docs.length > 0) {
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    }
    return null;
};

// ──────────────────────────────────────────────────
// Cohort Operations
// ──────────────────────────────────────────────────

export interface CohortData {
    name: string;
    description: string;
    startDate: any;
    endDate: any;
    maxStudents: number;
    status: "active" | "completed" | "upcoming";
    instructorId: string;
    instructorName: string;
    skills: string[];
}

export const createCohort = async (cohortData: CohortData) => {
    const cohortsCol = collection(db, "cohorts");
    const docRef = await addDoc(cohortsCol, {
        ...cohortData,
        currentStudents: 0,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
    });
    return docRef.id;
};

export const getCohorts = async (status?: string) => {
    const cohortsCol = collection(db, "cohorts");
    let q = query(cohortsCol);
    if (status) {
        q = query(cohortsCol, where("status", "==", status));
    }
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getInstructorCohorts = async (instructorId: string) => {
    const cohortsCol = collection(db, "cohorts");
    const q = query(cohortsCol, where("instructorId", "==", instructorId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const addStudentToCohort = async (cohortId: string, studentId: string, studentName: string) => {
    const cohortRef = doc(db, "cohorts", cohortId);
    const cohortDoc = await getDoc(cohortRef);
    if (!cohortDoc.exists()) throw new Error("Cohort not found");

    const cohortData = cohortDoc.data();
    const currentStudents = cohortData.currentStudents || 0;

    // Update cohort student count
    await updateDoc(cohortRef, {
        currentStudents: currentStudents + 1,
        updatedAt: Timestamp.now(),
    });

    // Create enrollment record
    const enrollmentRef = doc(db, "cohort_enrollments", `${cohortId}_${studentId}`);
    await setDoc(enrollmentRef, {
        cohortId,
        studentId,
        studentName,
        enrolledAt: Timestamp.now(),
    });
};

export const getCohortStudents = async (cohortId: string) => {
    const enrollmentsCol = collection(db, "cohort_enrollments");
    const q = query(enrollmentsCol, where("cohortId", "==", cohortId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

export const getStudentCohorts = async (studentId: string) => {
    const enrollmentsCol = collection(db, "cohort_enrollments");
    const q = query(enrollmentsCol, where("studentId", "==", studentId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

// ──────────────────────────────────────────────────
// Admin Broadcast Messaging
// ──────────────────────────────────────────────────

export const sendBroadcastMessage = async (
    senderId: string,
    senderName: string,
    subject: string,
    message: string,
    recipientIds: string[]
) => {
    const broadcastsCol = collection(db, "broadcasts");
    const docRef = await addDoc(broadcastsCol, {
        senderId,
        senderName,
        subject,
        message,
        recipientIds,
        sentAt: Timestamp.now(),
    });
    return docRef.id;
};

export const getBroadcasts = async () => {
    const broadcastsCol = collection(db, "broadcasts");
    const q = query(broadcastsCol, orderBy("sentAt", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};
