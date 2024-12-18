"use strict";

var pico8_gpio = new Array(128);

main();

function append_chat_message(chat_messages_element, message) {
  let message_element = document.createElement("p");
  message_element.appendChild(document.createTextNode(message));
  chat_messages_element.appendChild(message_element);
}


function copy_offer_cb() {
  var webrtc_offer_button = document.getElementById("webrtc_offer_button");
  navigator.clipboard.writeText(webrtc_offer_button.value);
  // document.execCommand("copy");
}

function set_webrtc_offer_input(is_webrtc_initiator, offer_string, url_params) {
  let webrtc_offer_input = document.getElementById("webrtc_offer_input");
  webrtc_offer_input.value = offer_string;

  let webrtc_offer_button = document.getElementById("webrtc_offer_button");
  if (!is_webrtc_initiator) {
    webrtc_offer_button.style.visibility = "hidden";
    return;
  }
  let url = window.location.href.substring(
    0, window.location.href.length - window.location.search.length);
  url += "?";
  if (url_params.has("stun_url")) {
    url += "stun_url=" + url_params.get("stun_url") + "&";
  }
  url += "webrtc_offer=" + encodeURIComponent(offer_string);
  webrtc_offer_button.value = url;
  webrtc_offer_button.innerHTML = "Copy WebRTC Offer";
}

function copy_answer_cb() {
  var copy_field = document.getElementById("webrtc_answer_input");
  copy_field.select();
  copy_field.setSelectionRange(0, 99999); // For mobile.
  navigator.clipboard.writeText(copy_field.value);
  // document.execCommand("copy");
}

function main() {
  var chat_messages_element = document.getElementById("chat_messages");

  const url_params = new URLSearchParams(window.location.search);
  const is_webrtc_initiator = !url_params.has("webrtc_offer");

  if (is_webrtc_initiator){
    pico8_gpio[0] = 0;
  }
  else { 
    pico8_gpio[0] = 1;
  }

  var stun_url = "stun.l.google.com:19302";
  if (url_params.has("stun_url")) {
    stun_url = decodeURIComponent(url_params.get("stun_url"));
  }

  var peer_connection_params = {};
  if (stun_url.length > 0) {
    peer_connection_params["iceServers"] = [{"urls": "stun:" + stun_url}];
  }
  var peer_connection = new RTCPeerConnection(peer_connection_params);

  var peer_data_channel = null;

  function init_data_channel(c) {
    peer_data_channel = c;
    peer_data_channel.onopen = function() {
      append_chat_message(chat_messages_element, "connected");
      pico8_gpio[2] = 1;
    }
    peer_data_channel.onmessage = function(ev) {
      // Messgae received from peer
      //append_chat_message(chat_messages_element, "recv: " + ev.data);

      let data = JSON.parse(ev.data);

      for (let i = 0; i < 9; i++) {
        pico8_gpio[i + 3] = data[i];
        console.log("recv: " + data[i]);
      }
      console.log("recv: " + data);
      pico8_gpio[1] = 2;
      
    }

    function chat_form_submit_cb() {
      if (!peer_data_channel || peer_data_channel.readyState != "open" || pico8_gpio[1] != 1) {
        return;
      }
      // Send message to peer
      pico8_gpio[1] = 0;

      let data = new Array(9);
      for (let i = 0; i < 9; i++) {
        data[i] = pico8_gpio[i + 3];
      }
      peer_data_channel.send(JSON.stringify(data));
    }
    setInterval(chat_form_submit_cb, 10);
    
  }

  if (is_webrtc_initiator) {
    let webrtc_answer_button = document.getElementById("webrtc_answer_button");
    webrtc_answer_button.style.visibility = "hidden";
    init_data_channel(peer_connection.createDataChannel("chat_chan"));
  } else {
    peer_connection.addEventListener("datachannel", ev => {
      init_data_channel(ev.channel);
    });
  }

  function ice_candidate_cb(e) {
    if (!e.candidate) {
      return;
    }
    // Don't actually send the peer any candidates.
    // We wait for gathering to complete (in promise_ice_gathered()),
    // then send our connection info to the peer in one shot.
    console.log(e);
  }

  peer_connection.onicecandidate = ice_candidate_cb;

  function promise_ice_gathered() {
    return new Promise(r => {
      peer_connection.addEventListener("icegatheringstatechange", e => {
        if (e.target.iceGatheringState === "complete") {
          r(peer_connection.localDescription);
        }
      });
    });
  }

  function offer_signal_cb(offer) {
    set_webrtc_offer_input(
        is_webrtc_initiator, JSON.stringify(offer), url_params);
  }

  function answer_signal_cb(answer) {
    let webrtc_answer_input = document.getElementById("webrtc_answer_input");
    webrtc_answer_input.value = JSON.stringify(answer);

    let webrtc_answer_button = document.getElementById("webrtc_answer_button");
    webrtc_answer_button.innerHTML = "Copy WebRTC Answer";
  }

  function promise_answer_pasted() {
    let input_element = document.getElementById("webrtc_answer_input");
    return new Promise(r => {
      append_chat_message(chat_messages_element, "Step 1 of 3: Share the WebRTC offer link with your friend.");
      append_chat_message(chat_messages_element, "Step 2 of 3: Ask them to copy their WebRTC answer.");
      append_chat_message(chat_messages_element, "Step 3 of 3: Paste that answer in the field above.");
      input_element.addEventListener("change", function paste_cb() {
        peer_connection.setRemoteDescription(JSON.parse(input_element.value));
        append_chat_message(chat_messages_element, "trying to connect...");
        input_element.removeEventListener("change", paste_cb);
        r();
      });
    });
  }

  if (is_webrtc_initiator) {
    peer_connection.createOffer()
      .then(offer => peer_connection.setLocalDescription(offer))
      .then(promise_ice_gathered)
      .then(offer_signal_cb)
      .then(promise_answer_pasted)
      .catch(e => {
        append_chat_message(chat_messages_element, "failed");
        append_chat_message(chat_messages_element, e);
      });
  } else {
    let offer = decodeURIComponent(url_params.get("webrtc_offer"));
    peer_connection.setRemoteDescription(JSON.parse(offer));
    set_webrtc_offer_input(is_webrtc_initiator, offer);

    peer_connection.createAnswer()
      .then(answer => peer_connection.setLocalDescription(answer))
      .then(promise_ice_gathered)
      .then(answer_signal_cb)
      .catch(e => {
        append_chat_message(chat_messages_element, "failed");
        append_chat_message(chat_messages_element, e);
      });
  }
}
