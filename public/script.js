const API_BASE_URL = ' http://localhost:3000'; // Replace with your deployed backend URL

document.addEventListener('DOMContentLoaded', () => {
  const loginDiv = document.getElementById('login');
  const chatDiv = document.getElementById('chat');
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const loginButton = document.getElementById('loginButton');
  const registerButton = document.getElementById('registerButton');
  const loginError = document.getElementById('loginError');
  const userSearchInput = document.getElementById('userSearchInput');
  const userSearchResults = document.getElementById('userSearchResults');
  const chatWithSpan = document.getElementById('chatWith');
  const messagesList = document.getElementById('messages');
  const messageForm = document.getElementById('messageForm');
  const messageInput = document.getElementById('messageInput');
  const darkModeToggleLogin = document.getElementById('darkModeToggle');
  const darkModeToggleChat = document.getElementById('darkModeToggleChat');

  let socket = null;
  let currentUser = null;
  let chatWith = null;
  let token = null;
  let typingTimeout = null;
  let isTyping = false;
  let onlineUsersSet = new Set();

  const reactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '🚩'];

  // Load dark mode preference
  if (localStorage.getItem('darkMode') === 'enabled') {
    document.body.classList.add('dark-mode');
  }

  darkModeToggleLogin.addEventListener('click', toggleDarkMode);
  darkModeToggleChat.addEventListener('click', toggleDarkMode);

  function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
      localStorage.setItem('darkMode', 'enabled');
    } else {
      localStorage.setItem('darkMode', 'disabled');
    }
  }

  // Audio notification setup
  const messageAudio = new Audio('notification.mp3');

  function playNotificationSound() {
    messageAudio.play().catch(e => {
      console.log('Audio play failed:', e);
    });
  }

  // Firebase messaging initialization for push notifications
  const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID"
  };

  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  function requestNotificationPermission() {
    console.log('Requesting notification permission...');
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        console.log('Notification permission granted.');
        getToken();
      } else {
        console.log('Unable to get permission to notify.');
      }
    });
  }

  function getToken() {
    messaging.getToken({ vapidKey: 'YOUR_PUBLIC_VAPID_KEY' }).then((currentToken) => {
      if (currentToken) {
        console.log('FCM Token:', currentToken);
        // TODO: Send the token to your server and save it for push notifications
      } else {
        console.log('No registration token available. Request permission to generate one.');
      }
    }).catch((err) => {
      console.log('An error occurred while retrieving token. ', err);
    });
  }

  requestNotificationPermission();

  // Add event listeners for iOS and Android launch buttons
  const iosLaunchButton = document.getElementById('iosLaunchButton');
  const androidLaunchButton = document.getElementById('androidLaunchButton');

  iosLaunchButton.addEventListener('click', () => {
    // Placeholder URL for iOS app store
    window.open('https://apps.apple.com/app/idXXXXXXXXX', '_blank');
  });

  androidLaunchButton.addEventListener('click', () => {
    // Placeholder URL for Google Play store
    window.open('https://play.google.com/store/apps/details?id=XXXXXXXXX', '_blank');
  });

  loginButton.addEventListener('click', async () => {
    loginError.textContent = '';
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      loginError.textContent = 'Please enter username and password.';
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (data.success) {
        currentUser = data.username;
        token = data.token;
        loginDiv.style.display = 'none';
        chatDiv.style.display = 'flex';
        connectSocket();
        loadInbox(); // Load inbox on login
      } else {
        loginError.textContent = data.error || 'Login failed.';
      }
    } catch (err) {
      loginError.textContent = 'Error connecting to server.';
    }
  });

  registerButton.addEventListener('click', async () => {
    loginError.textContent = '';
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      loginError.textContent = 'Please enter username and password.';
      return;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (data.success) {
        currentUser = username;
        // After registration, automatically login
        const loginResponse = await fetch(`${API_BASE_URL}/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const loginData = await loginResponse.json();
        if (loginData.success) {
          token = loginData.token;
          loginDiv.style.display = 'none';
          chatDiv.style.display = 'flex';
          connectSocket();
          loadInbox(); // Load inbox on login after registration
        } else {
          loginError.textContent = loginData.error || 'Login failed after registration.';
        }
      } else {
        loginError.textContent = data.error || 'Registration failed.';
      }
    } catch (err) {
      loginError.textContent = 'Error connecting to server.';
    }
  });

  function connectSocket() {
    socket = io(API_BASE_URL, {
      auth: {
        token: token
      }
    });

    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('private message', ({ from, message, timestamp }) => {
      if (from === chatWith) {
        addMessage(from, message, timestamp);
      }
      loadInbox();
    });

    socket.on('reaction updated', ({ from, to, timestamp, reactions }) => {
      updateMessageReactions(timestamp, reactions);
    });

    socket.on('message deleted', ({ from, to, timestamp }) => {
      markMessageDeleted(timestamp);
    });

  socket.on('user-online', (username) => {
    onlineUsersSet.add(username);
    updateUserPresenceUI();
  });

  socket.on('user-offline', (username) => {
    onlineUsersSet.delete(username);
    updateUserPresenceUI();
  });

  function updateUserPresenceUI() {
    const inboxList = document.getElementById('inboxList');
    if (!inboxList) return;

    window.requestAnimationFrame(() => {
      [...inboxList.children].forEach(li => {
        const userSpan = li.querySelector('span');
        if (!userSpan) return;
        const user = userSpan.textContent.trim();
        const isOnline = onlineUsersSet.has(user);
        if (isOnline && !li.classList.contains('user-online')) {
          li.classList.add('user-online');
          li.classList.remove('user-offline');
        } else if (!isOnline && !li.classList.contains('user-offline')) {
          li.classList.add('user-offline');
          li.classList.remove('user-online');
        }
      });

      if (chatWith) {
        const chatWithSpan = document.getElementById('chatWith');
        if (chatWithSpan) {
          const isOnline = onlineUsersSet.has(chatWith);
          if (isOnline && !chatWithSpan.classList.contains('user-online')) {
            chatWithSpan.classList.add('user-online');
            chatWithSpan.classList.remove('user-offline');
          } else if (!isOnline && !chatWithSpan.classList.contains('user-offline')) {
            chatWithSpan.classList.add('user-offline');
            chatWithSpan.classList.remove('user-online');
          }
        }
      }
    });
  }
  }

  let userSearchTimeout = null;
  userSearchInput.addEventListener('input', () => {
    clearTimeout(userSearchTimeout);
    const query = userSearchInput.value.trim();
    if (!query) {
      userSearchResults.innerHTML = '';
      return;
    }
  userSearchTimeout = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/search-users?q=${encodeURIComponent(query)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        displayUserSearchResults(data.users);
      } catch (err) {
        console.error('User search error:', err);
      }
    }, 300); // debounce delay 300ms
  });

  messageInput.addEventListener('input', () => {
    if (!socket || !chatWith) return;
    if (!isTyping) {
      isTyping = true;
      socket.emit('typing', { toUser: chatWith });
    }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      socket.emit('stop typing', { toUser: chatWith });
    }, 1000);
  });

  function displayUserSearchResults(users) {
    userSearchResults.innerHTML = '';
    users.forEach(user => {
      if (user === currentUser) return;
      const li = document.createElement('li');
      li.innerHTML = `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(user)}&background=ffeb3b&color=000" alt="avatar" class="avatar" />${user}`;
      li.addEventListener('click', () => {
        openChat(user);
      });
      userSearchResults.appendChild(li);
    });
  }

  // Typing indicator UI
  const typingIndicator = document.createElement('div');
  typingIndicator.id = 'typingIndicator';
  typingIndicator.style.fontStyle = 'italic';
  typingIndicator.style.marginTop = '5px';
  typingIndicator.style.display = 'none';
  chatDiv.appendChild(typingIndicator);

  socket?.on('typing', ({ from }) => {
    if (from === chatWith) {
      typingIndicator.textContent = `${from} is typing...`;
      typingIndicator.style.display = 'block';
    }
  });

  socket?.on('stop typing', ({ from }) => {
    if (from === chatWith) {
      typingIndicator.style.display = 'none';
    }
  });

  async function loadInbox() {
    try {
      const response = await fetch(`${API_BASE_URL}/inbox`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      displayInbox(data.inbox);
    } catch (err) {
      console.error('Failed to load inbox:', err);
    }
  }

  function displayInbox(inbox) {
    const inboxList = document.getElementById('inboxList');
    inboxList.innerHTML = '';
    inbox.forEach(item => {
      const li = document.createElement('li');

      const userSpan = document.createElement('span');
      const avatarImg = document.createElement('img');
      avatarImg.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(item.user)}&background=ffeb3b&color=000`;
      avatarImg.alt = 'avatar';
      avatarImg.classList.add('avatar');
      userSpan.appendChild(avatarImg);
      userSpan.appendChild(document.createTextNode(item.user));

      const unreadCountSpan = document.createElement('span');
      if (item.unreadCount > 0) {
        unreadCountSpan.textContent = item.unreadCount;
        unreadCountSpan.classList.add('unread-count');
      }

      const messageIconSpan = document.createElement('span');
      if (item.unreadCount > 0) {
        messageIconSpan.textContent = '🚩';
        messageIconSpan.classList.add('message-icon');
      }

      li.appendChild(userSpan);
      if (item.unreadCount > 0) {
        li.appendChild(unreadCountSpan);
        li.appendChild(messageIconSpan);
      }

      li.addEventListener('click', () => {
        openChat(item.user);
      });
      inboxList.appendChild(li);
    });
  }

  function openChat(user) {
    chatWith = user;
    chatWithSpan.textContent = user;
    messagesList.innerHTML = '';
    userSearchResults.innerHTML = '';
    userSearchInput.value = '';
    loadMessageHistory();
    loadInbox(); // Refresh inbox to update unread counts
    updateUserPresenceUI(); // Update online/offline status when opening chat
  }

  async function loadMessageHistory() {
    if (!chatWith) return;
  try {
      const response = await fetch(`${API_BASE_URL}/messages/${encodeURIComponent(chatWith)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      messagesList.innerHTML = '';
      data.messages.forEach(msg => {
        addMessage(msg.from, msg.message, msg.timestamp, msg.reactions, msg.deleted, msg.readBy);
      });
      updateUserPresenceUI();
    } catch (err) {
      console.error('Failed to load message history:', err);
    }
  }

  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!chatWith) {
      alert('Select a user to chat with');
      return;
    }
    const message = messageInput.value.trim();
    if (!message) return;
    socket.emit('private message', { to: chatWith, message });
    addMessage(currentUser, message, new Date().toISOString(), {}, false);
    messageInput.value = '';
    loadInbox(); // Refresh inbox after sending message
  });

  function addMessage(from, message, timestamp, reactions = {}, deleted = false, readBy = []) {
    const li = document.createElement('li');
    li.classList.add(from === currentUser ? 'from-me' : 'from-them');
    li.dataset.timestamp = timestamp;

    if (deleted) {
      li.textContent = 'Message deleted';
      li.classList.add('deleted-message');
      messagesList.appendChild(li);
      return;
    }

    // Detect if message is a GIF URL (simple check)
    if (isGifUrl(message)) {
      const img = document.createElement('img');
      img.src = message;
      img.alt = 'GIF';
      li.appendChild(img);
    } else if (isComicText(message)) {
      li.textContent = message;
      li.classList.add('comic-text');
    } else {
      li.textContent = message;
    }

    // Add reactions container
    const reactionsDiv = document.createElement('div');
    reactionsDiv.classList.add('reactions-container');

    for (const [emoji, users] of Object.entries(reactions)) {
      const reactionSpan = document.createElement('span');
      reactionSpan.classList.add('reaction');
      reactionSpan.textContent = `${emoji} ${users.length}`;
      reactionSpan.title = users.join(', ');
      reactionSpan.addEventListener('click', () => {
        if (users.includes(currentUser)) {
          socket.emit('remove reaction', { toUser: chatWith, timestamp, emoji });
        } else {
          socket.emit('add reaction', { toUser: chatWith, timestamp, emoji });
        }
      });
      reactionsDiv.appendChild(reactionSpan);
    }

    // Add button to add new reaction
    const addReactionBtn = document.createElement('button');
    addReactionBtn.textContent = '+';
    addReactionBtn.classList.add('add-reaction-btn');
    addReactionBtn.title = 'Add reaction';
    addReactionBtn.addEventListener('click', () => {
      showReactionPicker(li, timestamp);
    });
    reactionsDiv.appendChild(addReactionBtn);

    li.appendChild(document.createElement('br'));
    li.appendChild(reactionsDiv);

    // Add delete button if message is from current user
    if (from === currentUser && !deleted) {
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.classList.add('delete-message-btn');
      deleteBtn.title = 'Delete message';
      deleteBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete this message?')) {
          socket.emit('delete message', { toUser: chatWith, timestamp });
        }
      });
      li.appendChild(deleteBtn);
    }

    // Add read receipt indicator if message is from currentUser and read by other user
    if (from === currentUser && readBy && readBy.includes(chatWith)) {
      const readReceiptSpan = document.createElement('span');
      readReceiptSpan.classList.add('read-receipt');
      readReceiptSpan.textContent = '✓ Read';
      li.appendChild(readReceiptSpan);
    }

    messagesList.appendChild(li);
    messagesList.scrollTop = messagesList.scrollHeight;
  }

  function updateMessageReactions(timestamp, reactions) {
    const messageLi = [...messagesList.children].find(li => li.dataset.timestamp === timestamp);
    if (!messageLi) return;

    const reactionsDiv = messageLi.querySelector('.reactions-container');
    if (!reactionsDiv) return;

    // Clear existing reactions except add button
    while (reactionsDiv.firstChild) {
      reactionsDiv.removeChild(reactionsDiv.firstChild);
    }

    for (const [emoji, users] of Object.entries(reactions)) {
      const reactionSpan = document.createElement('span');
      reactionSpan.classList.add('reaction');
      reactionSpan.textContent = `${emoji} ${users.length}`;
      reactionSpan.title = users.join(', ');
      reactionSpan.addEventListener('click', () => {
        if (users.includes(currentUser)) {
          socket.emit('remove reaction', { toUser: chatWith, timestamp, emoji });
        } else {
          socket.emit('add reaction', { toUser: chatWith, timestamp, emoji });
        }
      });
      reactionsDiv.appendChild(reactionSpan);
    }

    // Add button to add new reaction
    const addReactionBtn = document.createElement('button');
    addReactionBtn.textContent = '+';
    addReactionBtn.classList.add('add-reaction-btn');
    addReactionBtn.title = 'Add reaction';
    addReactionBtn.addEventListener('click', () => {
      showReactionPicker(messageLi, timestamp);
    });
    reactionsDiv.appendChild(addReactionBtn);
  }

  function markMessageDeleted(timestamp) {
    const messageLi = [...messagesList.children].find(li => li.dataset.timestamp === timestamp);
    if (!messageLi) return;
    messageLi.textContent = 'Message deleted';
    messageLi.classList.add('deleted-message');
  }

  function showReactionPicker(messageLi, timestamp) {
    // Simple reaction picker popup
    const picker = document.createElement('div');
    picker.classList.add('reaction-picker');
    reactionEmojis.forEach(emoji => {
      const btn = document.createElement('button');
      btn.textContent = emoji;
      btn.classList.add('reaction-picker-btn');
      btn.addEventListener('click', () => {
        socket.emit('add reaction', { toUser: chatWith, timestamp, emoji });
        document.body.removeChild(picker);
      });
      picker.appendChild(btn);
    });
    // Position picker near message
    const rect = messageLi.getBoundingClientRect();
    picker.style.position = 'absolute';
    picker.style.top = `${rect.bottom + window.scrollY}px`;
    picker.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(picker);

    // Close picker on outside click
    function onClickOutside(event) {
      if (!picker.contains(event.target)) {
        document.body.removeChild(picker);
        document.removeEventListener('click', onClickOutside);
      }
    }
    setTimeout(() => {
      document.addEventListener('click', onClickOutside);
    }, 0);
  }

  function isGifUrl(text) {
    return /^https?:\/\/.*\.(gif|webp|mp4)$/i.test(text);
  }

  function isComicText(text) {
    // Simple heuristic: if text contains comic style markers like * or _
    return /[*_]/.test(text);
  }
});
