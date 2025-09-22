// app.js - modular Firebase + Google Maps + simple UI
// IMPORTANT: Replace firebaseConfig placeholders with your Firebase Web App config
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";
import { getFirestore, doc, setDoc, addDoc, collection, onSnapshot, getDocs, query, where, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-messaging.js";

// ----------------- FIREBASE CONFIG -----------------
// paste your Firebase web config here
const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();
const messaging = getMessaging(app);

// request permission / get FCM token
async function setupFCMToken(uid, role) {
  try {
    const vapidKey = "YOUR_VAPID_KEY_IF_SET"; // optional; if not set, remove from getToken call
    const currentToken = await getToken(messaging, { vapidKey });
    if (currentToken) {
      console.log("FCM token:", currentToken);
      await setDoc(doc(db, `${role}Tokens`, uid), { token: currentToken, updatedAt: serverTimestamp() });
    } else console.warn("No permission for notifications or token not available");
  } catch (err) {
    console.error("FCM token error", err);
  }
}

// handle foreground messages
onMessage(messaging, (payload) => {
  console.log("Message received. ", payload);
  alert("Push: " + (payload.notification?.title || JSON.stringify(payload)));
});

// ----------------- UI TAB LOGIC -----------------
const tabs = {
  customer: document.getElementById('customer-panel'),
  restaurant: document.getElementById('restaurant-panel'),
  driver: document.getElementById('driver-panel'),
  admin: document.getElementById('admin-panel')
};
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const id = btn.id.split('-')[1];
    Object.values(tabs).forEach(t=>t.classList.add('hidden'));
    tabs[id].classList.remove('hidden');
  });
});

// ----------------- Simple Helpers -----------------
const $ = id => document.getElementById(id);
const safeLog = (...a)=>{ try{ console.log(...a);}catch(e){} }

// ----------------- CUSTOMER: register/login, location, browse restaurants, order -----------------
$('cust-register').addEventListener('click', async ()=>{
  const email = $('cust-email').value;
  const pw = $('cust-password').value;
  const name = $('cust-name').value || "Customer";
  const user = await createUserWithEmailAndPassword(auth, email, pw);
  await setDoc(doc(db,'customers', user.user.uid), { name, createdAt: serverTimestamp() });
  await setupFCMToken(user.user.uid, 'customers');
  alert('Customer registered');
});
$('cust-login').addEventListener('click', async ()=>{
  const email = $('cust-email').value; const pw = $('cust-password').value;
  await signInWithEmailAndPassword(auth, email, pw);
  alert('Customer login attempt finished');
});

$('cust-use-geoloc').addEventListener('click', ()=>{
  if (!navigator.geolocation) return alert('Geolocation not supported');
  navigator.geolocation.getCurrentPosition(async pos=>{
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    $('cust-loc').textContent = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    const user = auth.currentUser;
    if (user) {
      await setDoc(doc(db,'customers', user.uid), { location: coords, name: $('cust-name').value || "" }, { merge: true });
    } else {
      console.warn('Not signed in. Location stored only on client for now.');
      window.__custPos = coords;
    }
  }, err => alert('Geolocation error: ' + err.message));
});

// load restaurants from Firestore
async function loadRestaurantsList(){
  const restList = $('restaurants-list');
  restList.innerHTML = '<em>Loading...</em>';
  const snapshot = await getDocs(collection(db, 'restaurants'));
  restList.innerHTML = '';
  snapshot.forEach(docSnap => {
    const r = docSnap.data(); const id = docSnap.id;
    const div = document.createElement('div'); div.className='rest';
    div.innerHTML = `<strong>${r.name}</strong><div class="small">${r.contact||''}</div>
      <div>${(r.menu||[]).map(m=>`<div>${m.title} - $${m.price}</div>`).join('')}</div>
      <button data-id="${id}" class="order-from">Order from here</button>`;
    restList.appendChild(div);
  });
  document.querySelectorAll('.order-from').forEach(b=>{
    b.addEventListener('click', ()=>startOrder(b.dataset.id));
  });
}
loadRestaurantsList();

// start a simple order flow (one static item for demo)
async function startOrder(restId){
  const cust = auth.currentUser;
  if (!cust && !window.__custPos) return alert('Please login and set your location');
  const customerId = cust ? cust.uid : 'guest-' + Date.now();
  const order = {
    restaurantId: restId,
    customerId,
    status: 'placed',
    createdAt: serverTimestamp(),
    customerLoc: (cust ? (await (await doc(db,'customers',customerId).get()).data())?.location : window.__custPos) || window.__custPos,
    items: [{ title:'Demo item', price:9.99 }],
  };
  // save order
  const orderRef = await addDoc(collection(db,'orders'), order);
  alert('Order placed (id=' + orderRef.id + '). Waiting for restaurant to accept.');
  // restaurant will accept -> then server notifies drivers (server code provided)
}

// ----------------- RESTAURANT: register/login, add menu, accept orders -----------------
$('rest-register').addEventListener('click', async ()=>{
  const email = $('rest-email').value, pw = $('rest-password').value, name = $('rest-name').value;
  const user = await createUserWithEmailAndPassword(auth, email, pw);
  await setDoc(doc(db,'restaurants', user.user.uid), { name, contact: email, menu: [], createdAt: serverTimestamp() });
  await setupFCMToken(user.user.uid, 'restaurants');
  alert('Restaurant registered');
});

$('rest-login').addEventListener('click', async ()=>{
  const email = $('rest-email').value; const pw = $('rest-password').value;
  await signInWithEmailAndPassword(auth, email, pw);
  alert('Restaurant login attempt finished');
});

$('add-menu-item').addEventListener('click', async ()=>{
  const title = $('menu-title').value, price = parseFloat($('menu-price').value) || 0, img = $('menu-img').value;
  const user = auth.currentUser; if (!user) return alert('Login as restaurant first');
  const rdoc = doc(db,'restaurants', user.uid);
  // naive merge push
  await updateDoc(rdoc, {
    menu: ( (await (await rdoc.get()).data()?.menu) || [] ).concat({ title, price, img })
  }).catch(async err=>{
    // fallback to set if no menu
    await setDoc(rdoc, { menu: [{ title, price, img }], name: $('rest-name').value || 'Unnamed' }, { merge: true });
  });
  alert('Menu item added (may need refresh).');
});

// listen to orders for restaurants
function subscribeRestaurantOrders(){
  const user = auth.currentUser;
  if (!user) return;
  const q = query(collection(db, 'orders'), where('restaurantId','==', user.uid));
  onSnapshot(q, snap=>{
    const wrap = $('rest-orders'); wrap.innerHTML = '';
    snap.forEach(docSnap=>{
      const order = docSnap.data(); const id = docSnap.id;
      const div = document.createElement('div'); div.className='order';
      div.innerHTML = `<strong>Order ${id}</strong> - ${order.status}
        <div class="small">Customer: ${order.customerId}</div>
        <button class="accept" data-id="${id}">Accept</button> <button class="decline" data-id="${id}">Decline</button>`;
      wrap.appendChild(div);
    });
    wrap.querySelectorAll('.accept').forEach(b=>b.addEventListener('click', async ()=>{ await updateDoc(doc(db,'orders',b.dataset.id), { status:'accepted', acceptedAt: serverTimestamp(), restaurantId: auth.currentUser.uid }); alert('Accepted'); /* server will then notify drivers */ }));
    wrap.querySelectorAll('.decline').forEach(b=>b.addEventListener('click', async ()=>{ await updateDoc(doc(db,'orders',b.dataset.id), { status:'declined' }); alert('Declined'); }));
  });
}

// ----------------- DRIVER: register/login, share location, accept requests -----------------
let shareWatcher = null;
$('drv-register').addEventListener('click', async ()=>{
  const email = $('drv-email').value; const pw = $('drv-password').value; const name = $('drv-name').value;
  const user = await createUserWithEmailAndPassword(auth, email, pw);
  await setDoc(doc(db,'drivers', user.user.uid), { name, createdAt: serverTimestamp(), available: true });
  await setupFCMToken(user.user.uid, 'drivers');
  alert('Driver registered');
});
$('drv-login').addEventListener('click', async ()=>{
  const email = $('drv-email').value; const pw = $('drv-password').value;
  await signInWithEmailAndPassword(auth, email, pw);
  alert('Driver login attempt finished');
});

$('start-sharing').addEventListener('click', ()=>{
  if (!navigator.geolocation) return alert('No geolocation support');
  if (shareWatcher) return alert('Already sharing');
  shareWatcher = navigator.geolocation.watchPosition(async pos=>{
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    $('drv-current').textContent = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    const user = auth.currentUser; if (!user) return;
    await setDoc(doc(db,'drivers', user.uid), { location: coords, available: true, updatedAt: serverTimestamp() }, { merge: true });
  }, err => console.error(err), { enableHighAccuracy:true, maximumAge:10000, timeout:10000 });
});
$('stop-sharing').addEventListener('click', async ()=>{
  if (shareWatcher) { navigator.geolocation.clearWatch(shareWatcher); shareWatcher = null; $('drv-current').textContent='Not sharing'; }
  const user = auth.currentUser; if (user) await updateDoc(doc(db,'drivers',user.uid), { available:false });
});

// listen for incoming delivery requests that are targeted to driver (simple approach)
function subscribeDriverRequests(){
  const user = auth.currentUser; if (!user) return;
  const q = query(collection(db,'driverRequests'), where('driverId','==', user.uid));
  onSnapshot(q, snap=>{
    const wrap = $('drv-requests'); wrap.innerHTML='';
    snap.forEach(s => {
      const r = s.data();
      const div = document.createElement('div');
      div.innerHTML = `<strong>Request ${s.id}</strong><div class="small">Order ${r.orderId}</div>
        <button class="accept" data-id="${s.id}">Accept</button>`;
      wrap.appendChild(div);
    });
    wrap.querySelectorAll('.accept').forEach(b=>{
      b.addEventListener('click', async ()=>{
        const reqId = b.dataset.id;
        const reqDoc = doc(db,'driverRequests', reqId);
        await updateDoc(reqDoc, { accepted: true, acceptedAt: serverTimestamp() });
        // mark order assigned
        const req = (await (await reqDoc.get()).data());
        await updateDoc(doc(db,'orders', req.orderId), { driverId: auth.currentUser.uid, status:'driver_assigned' });
        alert('Request accepted and order assigned to you');
      });
    });
  });
}

// ----------------- CUSTOMER: map + track driver live -----------------
let map, customerMarker, driverMarker;
function initMap(lat=20, lng=0){
  map = new google.maps.Map(document.getElementById('map'), { center: {lat,lng}, zoom:13 });
  customerMarker = new google.maps.Marker({ map, label:'C' });
  driverMarker = new google.maps.Marker({ map, label:'D', icon: { path: google.maps.SymbolPath.CIRCLE, scale:6, fillColor:'#f00', fillOpacity:1, strokeWeight:1 }});
}

// init map with default
initMap(24.4539, 54.3773); // default center (Muscat-ish) - change as needed

// subscribe to order updates (customer side) to show driver
function subscribeOrderDriverTracking(orderId){
  // Listen to the order's driverId changes and then listen to that driver's location
  const orderRef = doc(db,'orders',orderId);
  onSnapshot(orderRef, async snap=>{
    const order = snap.data();
    if (!order) return console.log('Order snapshot empty');
    if (order.customerLoc) {
      customerMarker.setPosition(order.customerLoc);
      map.setCenter(order.customerLoc);
    }
    if (order.driverId) {
      const driverRef = doc(db,'drivers', order.driverId);
      onSnapshot(driverRef, driverSnap=>{
        const d = driverSnap.data();
        if (!d?.location) return;
        driverMarker.setPosition(d.location);
        // optionally draw route using DirectionsService (omitted to keep this example simple)
      });
    }
  });
}

// ----------------- ADMIN: simple overview -----------------
$('admin-refresh').addEventListener('click', async ()=>{
  const out = $('admin-data'); out.innerHTML = 'Loading...';
  const [custs, rests, drivs, orders] = await Promise.all([
    getDocs(collection(db,'customers')),
    getDocs(collection(db,'restaurants')),
    getDocs(collection(db,'drivers')),
    getDocs(collection(db,'orders')),
  ]);
  out.innerHTML = `<div>Customers: ${custs.size}</div><div>Restaurants: ${rests.size}</div><div>Drivers: ${drivs.size}</div><div>Orders: ${orders.size}</div>`;
});

// ----------------- AUTH STATE: wire listeners for role-specific live updates -----------------
onAuthStateChanged(auth, async user=>{
  if (!user) return;
  const uid = user.uid;
  // if user is restaurant
  const restDoc = (await (await doc(db,'restaurants',uid).get()).data());
  if (restDoc) {
    subscribeRestaurantOrders();
  }
  const driverDoc = (await (await doc(db,'drivers',uid).get()).data());
  if (driverDoc) {
    subscribeDriverRequests();
  }
  // always set token for push
  await setupFCMToken(uid, restDoc? 'restaurants' : driverDoc ? 'drivers' : 'customers');
});

// expose debug functions for demo
window.__debug = { loadRestaurantsList, subscribeOrderDriverTracking, initMap };

