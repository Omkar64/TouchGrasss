import type { Dispatch, SetStateAction } from 'react';
import type { AppSession, AppTab, FocusProgress, Friend, GatekeeperConnection, LawnPost, PostImage, Subpage, UnlockGrant, UnlockRequest } from '../types';

// Screen handlers may be synchronous (state changes) or asynchronous (network/native work).
type AsyncOrSync = void | Promise<unknown>;

// Shared contract passed from the app controller to each screen component.
export type ScreenProps = {
  // Signed-in account data and navigation selection.
  requests: UnlockRequest[];
  session: AppSession;
  connections: GatekeeperConnection[];
  subpage: Subpage;
  target: string;
  setTarget: (target: string) => void;
  notice: string;
  busy: boolean;
  // Local recording state and actions used by the request screen/inbox.
  isRecording: boolean;
  proofUri: string | null;
  proofUploading: boolean;
  proofPlaying: boolean;
  recordVoiceProof: () => AsyncOrSync;
  stopProofAudio: () => AsyncOrSync;
  playLocalProof: () => AsyncOrSync;
  sendVoiceProof: () => AsyncOrSync;
  // Gatekeeper pairing and moderation actions.
  inviteCode: string;
  setInviteCode: (code: string) => void;
  generatedCode: string;
  createInvite: () => AsyncOrSync;
  redeemInvite: () => AsyncOrSync;
  proofLoadingId: string | null;
  playingRequestId: string | null;
  playProof: (request: UnlockRequest) => AsyncOrSync;
  review: (requestId: string, minutes: number | null) => AsyncOrSync;
  // Focus session state and Android blocking controls.
  tab: AppTab;
  grounded: boolean;
  appBlocking: boolean;
  seconds: number;
  focusMinutes: string;
  setFocusMinutes: (minutes: string) => void;
  progress: FocusProgress;
  startFocus: () => AsyncOrSync;
  toggleAppBlocking: (enabled: boolean) => AsyncOrSync;
  accessibility: boolean;
  setSubpage: (page: Subpage) => void;
  grants: UnlockGrant[];
  cancelRequest: (id: string) => AsyncOrSync;
  // Friend feed state and actions.
  running: boolean;
  postDraft: string;
  setPostDraft: (draft: string) => void;
  postImage: PostImage | null;
  setPostImage: (image: PostImage | null) => void;
  choosePostImage: () => AsyncOrSync;
  publishPost: () => AsyncOrSync;
  posts: LawnPost[];
  cheeredPosts: Set<string>;
  setCheeredPosts: Dispatch<SetStateAction<Set<string>>>;
  friends: Friend[];
  createFriendInvite: () => AsyncOrSync;
  generatedFriendCode: string;
  friendCode: string;
  setFriendCode: (code: string) => void;
  redeemFriendInvite: () => AsyncOrSync;
  toggleGrounded: (enabled: boolean) => AsyncOrSync;
  setNotice: (notice: string) => void;
  // Values derived by MainScreens for the currently signed-in user.
  primaryConnection?: GatekeeperConnection;
  inbox?: UnlockRequest[];
  mine?: UnlockRequest[];
  overseenCount?: number;
};

export type MainScreensProps = Omit<ScreenProps, 'primaryConnection' | 'inbox' | 'mine' | 'overseenCount'>;
