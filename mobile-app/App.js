import React, { useState, useEffect, useRef } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import io from 'socket.io-client';
import axios from 'axios';
import { Audio } from 'expo-av';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const BACKEND_URL = 'http://your-backend-url.com'; // Replace with your deployed backend URL

const Stack = createNativeStackNavigator();

function LoginScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const login = async () => {
    setError('');
    if (!username || !password) {
      setError('Please enter username and password.');
      return;
    }
    try {
      const response = await axios.post(`${BACKEND_URL}/login`, { username, password });
      if (response.data.success) {
        navigation.replace('Chat', { username, token: response.data.token });
      } else {
        setError(response.data.error || 'Login failed.');
      }
    } catch (err) {
      setError('Error connecting to server.');
    }
  };

  const register = async () => {
    setError('');
    if (!username || !password) {
      setError('Please enter username and password.');
      return;
    }
    try {
      const response = await axios.post(`${BACKEND_URL}/register`, { username, password });
      if (response.data.success) {
        await login();
      } else {
        setError(response.data.error || 'Registration failed.');
      }
    } catch (err) {
      setError('Error connecting to server.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Login or Register</Text>
      <TextInput placeholder="Username" value={username} onChangeText={setUsername} style={styles.input} autoCapitalize="none" />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} style={styles.input} secureTextEntry />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.buttonRow}>
        <Button title="Login" onPress={login} />
        <Button title="Register" onPress={register} />
      </View>
    </SafeAreaView>
  );
}

function ChatScreen({ route }) {
  const { username, token } = route.params;
  const [socket, setSocket] = useState(null);
  const [chatWith, setChatWith] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const soundRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    const s = io(BACKEND_URL, { auth: { token } });
    setSocket(s);

    s.on('private message', async ({ from, message, timestamp }) => {
      if (from === chatWith) {
        setMessages(prev => [...prev, { from, message, timestamp }]);
        await playNotificationSound();
      }
      loadInbox();
    });

    s.on('reaction updated', ({ from, to, timestamp, reactions }) => {
      if (chatWith && (from === chatWith || to === chatWith)) {
        loadMessages(chatWith);
      }
    });

    s.on('message deleted', ({ from, to, timestamp }) => {
      if (chatWith && (from === chatWith || to === chatWith)) {
        loadMessages(chatWith);
      }
    });

    s.on('typing', ({ from }) => {
      setTypingUsers(prev => ({ ...prev, [from]: true }));
    });

    s.on('stop typing', ({ from }) => {
      setTypingUsers(prev => {
        const newTyping = { ...prev };
        delete newTyping[from];
        return newTyping;
      });
    });

    s.on('user-online', (username) => {
      setOnlineUsers(prev => new Set(prev).add(username));
    });

    s.on('user-offline', (username) => {
      setOnlineUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(username);
        return newSet;
      });
    });

    return () => {
      s.disconnect();
    };
  }, [chatWith]);

  useEffect(() => {
    loadInbox();
  }, []);

  const playNotificationSound = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.replayAsync();
      } else {
        const { sound } = await Audio.Sound.createAsync(
          require('./assets/notification.mp3')
        );
        soundRef.current = sound;
        await sound.playAsync();
      }
    } catch (error) {
      console.log('Error playing sound:', error);
    }
  };

  const loadInbox = async () => {
    try {
      const response = await axios.get(`${BACKEND_URL}/inbox`, { headers: { Authorization: `Bearer ${token}` } });
      setInbox(response.data.inbox);
    } catch (err) {
      console.error('Failed to load inbox', err);
    }
  };

  const loadMessages = async (user) => {
    try {
      const response = await axios.get(`${BACKEND_URL}/messages/${user}`, { headers: { Authorization: `Bearer ${token}` } });
      setMessages(response.data.messages);
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  };

  const openChat = (user) => {
    setChatWith(user);
    loadMessages(user);
  };

  const sendMessage = () => {
    if (!messageText.trim() || !chatWith) return;
    socket.emit('private message', { to: chatWith, message: messageText });
    setMessages(prev => [...prev, { from: username, message: messageText, timestamp: new Date().toISOString() }]);
    setMessageText('');
    loadInbox();
  };

  // Typing indicator handlers
  const handleTyping = () => {
    if (!socket || !chatWith) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit('typing', { toUser: chatWith });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socket.emit('stop typing', { toUser: chatWith });
    }, 1000);
  };

  const addReaction = (timestamp, emoji) => {
    if (!chatWith) return;
    socket.emit('add reaction', { toUser: chatWith, timestamp, emoji });
  };

  const removeReaction = (timestamp, emoji) => {
    if (!chatWith) return;
    socket.emit('remove reaction', { toUser: chatWith, timestamp, emoji });
  };

  const deleteMessage = (timestamp) => {
    if (!chatWith) return;
    Alert.alert(
      'Delete Message',
      'Are you sure you want to delete this message?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          socket.emit('delete message', { toUser: chatWith, timestamp });
          loadMessages(chatWith);
          loadInbox();
        }}
      ]
    );
  };

  const searchUsers = async (text) => {
    setUserSearch(text);
    if (!text.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const response = await axios.get(`${BACKEND_URL}/search-users?q=${encodeURIComponent(text)}`, { headers: { Authorization: `Bearer ${token}` } });
      setSearchResults(response.data.users.filter(u => u !== username));
    } catch (err) {
      console.error('User search error', err);
    }
  };

  const renderMessageItem = ({ item }) => {
    const isFromMe = item.from === username;
    const isReadByOther = item.readBy && item.readBy.includes(chatWith);
    return (
      <View style={[styles.messageItem, isFromMe ? styles.messageFromMe : styles.messageFromThem]}>
        <Text>{item.message}</Text>
        <View style={styles.reactionsContainer}>
          {item.reactions && Object.entries(item.reactions).map(([emoji, users]) => (
            <TouchableOpacity
              key={emoji}
              onPress={() => {
                if (users.includes(username)) {
                  removeReaction(item.timestamp, emoji);
                } else {
                  addReaction(item.timestamp, emoji);
                }
              }}
              style={styles.reactionButton}
            >
              <Text>{emoji} {users.length}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => showReactionPicker(item.timestamp)} style={styles.addReactionButton}>
            <Text>+</Text>
          </TouchableOpacity>
          {isFromMe && (
            <TouchableOpacity onPress={() => deleteMessage(item.timestamp)} style={styles.deleteButton}>
              <Text>Delete</Text>
            </TouchableOpacity>
          )}
          {isFromMe && isReadByOther && (
            <Text style={styles.readReceipt}>✓ Read</Text>
          )}
        </View>
      </View>
    );
  };

  const [reactionPickerVisible, setReactionPickerVisible] = useState(false);
  const [reactionPickerTimestamp, setReactionPickerTimestamp] = useState(null);
  const reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🚩'];

  const showReactionPicker = (timestamp) => {
    setReactionPickerTimestamp(timestamp);
    setReactionPickerVisible(true);
  };

  const selectReaction = (emoji) => {
    if (reactionPickerTimestamp) {
      addReaction(reactionPickerTimestamp, emoji);
      setReactionPickerVisible(false);
      setReactionPickerTimestamp(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inboxContainer}>
        <Text style={styles.title}>Inbox</Text>
        <FlatList
          data={inbox}
          keyExtractor={item => item.user}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => openChat(item.user)} style={styles.inboxItem}>
              <Text>{item.user} {item.unreadCount > 0 ? `({item.unreadCount})` : ''}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
      <View style={styles.searchContainer}>
        <TextInput
          placeholder="Search users"
          value={userSearch}
          onChangeText={searchUsers}
          style={styles.input}
          autoCapitalize="none"
        />
        <FlatList
          data={searchResults}
          keyExtractor={item => item}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => openChat(item)} style={styles.inboxItem}>
              <Text>{item}</Text>
            </TouchableOpacity>
          )}
        />
      </View>
      <View style={styles.chatContainer}>
        <Text style={styles.title}>Chat with {chatWith || '...'}</Text>
        <FlatList
          data={messages}
          keyExtractor={item => item.timestamp}
          renderItem={renderMessageItem}
        />
        <View style={styles.messageInputRow}>
          <TextInput
            placeholder="Type a message"
            value={messageText}
            onChangeText={text => {
              setMessageText(text);
              handleTyping();
            }}
            style={styles.messageInput}
          />
          <Button title="Send" onPress={sendMessage} />
        </View>
        {reactionPickerVisible && (
          <View style={styles.reactionPicker}>
            {reactionEmojis.map(emoji => (
              <TouchableOpacity key={emoji} onPress={() => selectReaction(emoji)} style={styles.reactionPickerButton}>
                <Text style={styles.reactionPickerText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
            <Button title="Cancel" onPress={() => setReactionPickerVisible(false)} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 10, backgroundColor: '#f0f0f0' },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 8, marginBottom: 10 },
  buttonRow: { flexDirection: 'row', justifyContent: 'space-between' },
  inboxContainer: { flex: 1 },
  inboxItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#ccc' },
  searchContainer: { flex: 1 },
  chatContainer: { flex: 3 },
  messageItem: { padding: 10, marginVertical: 5, borderRadius: 5 },
  messageFromMe: { backgroundColor: '#007bff', color: 'white', alignSelf: 'flex-end' },
  messageFromThem: { backgroundColor: '#e0e0e0', alignSelf: 'flex-start' },
  messageInputRow: { flexDirection: 'row', alignItems: 'center' },
  messageInput: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 5, padding: 8, marginRight: 10 },
  reactionsContainer: { flexDirection: 'row', marginTop: 5, alignItems: 'center' },
  reactionButton: { marginRight: 8, padding: 4, backgroundColor: '#ddd', borderRadius: 4 },
  addReactionButton: { marginRight: 8, padding: 4, backgroundColor: '#bbb', borderRadius: 4 },
  deleteButton: { padding: 4, backgroundColor: '#f44336', borderRadius: 4 },
  reactionPicker: { position: 'absolute', bottom: 60, left: 10, right: 10, backgroundColor: '#fff', padding: 10, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  reactionPickerButton: { padding: 10 },
  reactionPickerText: { fontSize: 24 },
  readReceipt: { marginLeft: 10, fontSize: 12, color: '#4caf50', fontWeight: 'bold' }
});
