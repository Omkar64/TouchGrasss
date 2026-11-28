import React from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Ionicons from '../../node_modules/expo/node_modules/@expo/vector-icons/Ionicons';
import { Avatar, Button, Card, formatMomentTime, styles } from '../ui';
import type { ScreenProps } from './types';

const forest = '#1A3C27';

// Lets a user publish a short real-world update and react to friends' moments.
export function LawnScreen(props: ScreenProps) {
  const { postDraft, setPostDraft, postImage, setPostImage, choosePostImage, busy, publishPost, posts, cheeredPosts, setCheeredPosts, friends } = props;
  return <ScrollView contentContainerStyle={styles.page}>
    {/* The composer accepts text, an optional local photo, or both. */}
    <Text style={styles.kicker}>THE LAWN</Text><Text style={styles.heading}>Touch grass{'\n'}together.</Text><Text style={styles.muted}>Share a small real-world win with your friends.</Text>
    <Card><Text style={styles.cardTitle}>Share a moment</Text><TextInput multiline maxLength={500} placeholder="Went for a walk, hit the gym, read outside..." value={postDraft} onChangeText={setPostDraft} style={[styles.input, styles.postInput]} /><Text style={styles.smallMuted}>{postDraft.length}/500</Text>{postImage ? <><Image source={{ uri: postImage.uri }} style={styles.postImage} /><Pressable onPress={() => setPostImage(null)}><Text style={styles.link}>Remove image</Text></Pressable></> : null}<Pressable onPress={choosePostImage} disabled={busy} style={[styles.button, styles.buttonOutline, busy && { opacity: .5 }]}><View style={styles.buttonWithIcon}><Ionicons name="camera-outline" size={18} color={forest} /><Text style={[styles.buttonLabel, styles.buttonLabelSecondary]}>{postImage ? 'Change photo' : 'Add a photo'}</Text></View></Pressable><Button label={busy ? 'Posting…' : 'Post to friends'} primary onPress={publishPost} disabled={busy || (!postDraft.trim() && !postImage)} /></Card>
    {/* Feed rows are hydrated with signed image URLs and display names by useSocial. */}
    <Text style={styles.sectionTitle}>Friends’ moments</Text>{posts.length ? posts.map(post => { const cheered = cheeredPosts.has(post.id); return <Card key={post.id}><View style={styles.postHeader}><Avatar name={post.display_name} /><View style={styles.flex}><Text style={styles.cardTitle}>{post.display_name}</Text><Text style={styles.feedTime}>{formatMomentTime(post.created_at)}</Text></View></View>{post.body ? <Text style={styles.headingSmall}>{post.body}</Text> : null}{post.image_url ? <Image source={{ uri: post.image_url }} style={styles.postImage} /> : null}<Pressable onPress={() => setCheeredPosts(current => { const next = new Set(current); cheered ? next.delete(post.id) : next.add(post.id); return next; })} style={[styles.cheerButton, cheered && styles.cheerButtonActive]}><Ionicons name={cheered ? 'leaf' : 'leaf-outline'} size={17} color={forest} /><Text style={styles.cheerText}>{cheered ? 'Cheered' : 'Send a cheer'}</Text></Pressable></Card>; }) : <Card><Text style={styles.cardTitle}>Your Lawn is quiet for now</Text><Text style={styles.muted}>{friends.length ? 'Share your first moment or invite a friend to get the conversation growing.' : 'Add a friend in Squad to share posts with each other.'}</Text></Card>}
  </ScrollView>;
}
