import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
const { google } = require("googleapis");
const service = google.youtube("v3");

admin.initializeApp();
const db = admin.database();

/**
 * Fetch a video from the YouTube API based on search query and add to queue
 */
export const addVideoToQueue = functions.https.onCall(async (data, context) => {
  return await service.videos
    .list({
      auth: process.env.FIREBASE_API_KEY,
      part: "snippet",
      id: data.id,
    })
    .then(async (video: any) => {
      if (video) {
        const videoData = video.data.items[0];
        return await service.channels
          .list({
            auth: process.env.FIREBASE_API_KEY,
            part: "snippet",
            id: videoData.snippet.channelId,
          })
          .then(async (channel: any) => {
            if (channel) {
              const channelThumbnail =
                channel.data.items[0].snippet.thumbnails["default"].url;
              const key = await admin
                .database()
                .ref(`rooms/${data.room}/queue/top`)
                .once("value")
                .then((snapshot) => {
                  return snapshot.exists() ? snapshot.val() : 0;
                });

              const isVideoInQueue = await admin
                .database()
                .ref(`rooms/${data.room}/video`)
                .once("value")
                .then((snapshot) => {
                  return snapshot.hasChild("videoId");
                });

              const model = {
                channelId: videoData.snippet.channelId,
                channelThumbnail: channelThumbnail,
                channelTitle: videoData.snippet.channelTitle,
                videoId: videoData.id,
                videoThumbnail: videoData.snippet.thumbnails["default"].url,
                videoTitle: videoData.snippet.title,
                action: "play",
                time: 0,
              };

              const reference = isVideoInQueue
                ? `rooms/${data.room}/queue/items/${key}`
                : `rooms/${data.room}/video`;
              return await admin
                .database()
                .ref(reference)
                .set(model)
                .then(async () => {
                  if (isVideoInQueue) {
                    await admin
                      .database()
                      .ref(`rooms/${data.room}/queue/top`)
                      .transaction((current) => {
                        return (current || 0) + 1;
                      });
                  }
                  return 200;
                })
                .catch((error) => {
                  console.log(error);
                  return 500;
                });
            } else {
              return 500;
            }
          })
          .catch((error: any) => {
            console.log(error);
            return 500;
          });
      } else {
        return 500;
      }
    })
    .catch((error: any) => {
      console.log(error);
      return 500;
    });
});

/**
 * Listen to action changes in the room
 */
export const onActionChange = functions.database
  .ref("/rooms/{room}/video/action")
  .onUpdate(async (snapshot, context) => {
    switch (snapshot.after.val()) {
      case "next":
        // Get next video pointer
        const key = await admin
          .database()
          .ref(`rooms/${context.params.room}/queue/next`)
          .once("value")
          .then((snapshot) => {
            return snapshot.val() ? snapshot.val() : 0;
          });

        // Get next video
        await admin
          .database()
          .ref(`rooms/${context.params.room}/queue/items/${key}`)
          .once("value")
          .then(async (response) => {
            const video = response.val();
            console.log(video);
            if (video) {
              await admin
                .database()
                .ref(`rooms/${context.params.room}/video`)
                .set(video)
                .then(async () => {
                  console.log("Video changed");

                  // Remove video from queue
                  await admin
                    .database()
                    .ref(`rooms/${context.params.room}/queue/items/${key}`)
                    .remove()
                    .catch((error) => {
                      console.log(error);
                    });

                  // Advance queue
                  await admin
                    .database()
                    .ref(`rooms/${context.params.room}/queue/next`)
                    .transaction((currentValue) => {
                      return (currentValue || 0) + 1;
                    });
                })
                .catch((error) => {
                  console.log(error);
                });
            } else {
              await admin
                .database()
                .ref(`rooms/${context.params.room}/video`)
                .set({
                  action: "pause",
                  time: 0,
                });
            }
          })
          .catch((error) => {
            console.log(error);
          });
        break;
      case "set":
        setTimeout(() => { }, 500);
        await admin
          .database()
          .ref(`rooms/${context.params.room}/video/action`)
          .set(snapshot.before.val);
    }
  });

/**
 * Clean rooms every morning at 3 AM
 */
export const cleanRoom = functions.pubsub
  .schedule("0 3 * * *")
  .onRun(async (context) => {
    await admin
      .database()
      .ref("rooms")
      .once("value")
      .then(async (snapshot) => {
        snapshot.forEach((room) => {
          if (!room.hasChild("users")) {
            db.ref(`rooms/${room.key}`).remove();
            db.ref(`messages/${room.key}`).remove();
          }
        });
      });
  });
