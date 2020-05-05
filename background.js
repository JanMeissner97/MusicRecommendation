// background.js
// Autor: Jan Meißner
/*
*
* Problems: Last.fm doesnt always return similar songs, youtube api limit. 
*/

// Called when the user clicks on the browser action.
chrome.browserAction.onClicked.addListener(function(tab) {
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    //Get currently open track in youtube through tab title.
    var activeTrackname = tabs[0].title.split("- YouTube")[0];
    if (LOGGING) console.log("Active Trackname: " + activeTrackname);
    main(activeTrackname);

  });
});

function loadClient() {
  gapi.client.setApiKey(YOUTUBE_API_KEY);
  return gapi.client.load("https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest")
    .then(function() { console.log("GAPI client loaded for API"); },
        function(err) { console.error("Error loading GAPI client for API", err); });
};

/* main function
*
*
*/
async function main(activeTrackname){
  const activeTrack = await searchTrack(activeTrackname);
  if (LOGGING) console.log("Found active track: " + activeTrack);
  const similarSongs = await getSimilarSongs(activeTrack);
  if (similarSongs.length == 0) console.error("No similar songs found! Please check network for api call");
  if (LOGGING) console.log(similarSongs);
  createUnlistedPlaylist(similarSongs);
}

/* Finds Similar Songs on last.fm. Last Fm might return none.
*
*  @param track - track object that implements .name and .artist
*  @return      - returns array of track objects
*/
async function getSimilarSongs(track) {
  const searchQuery = "http://ws.audioscrobbler.com/2.0/?method=track.getsimilar"
                      + "&artist=" + escape(track.artist)
                      + "&track=" + escape(track.name)
                      + "&api_key=" + LAST_FM_API_KEY
                      + "&format=json"
                      + "&limit=" + MAX_PLAYLIST_LENGTH;
  const response = await fetch(searchQuery);
  const myJson = await response.json();
  const tracks = myJson.similartracks.track;

  var tracklist = [];
  for (var i = 0; i < tracks.length; i++){
    tracklist.push({name: tracks[i].name, artist: tracks[i].artist.name});
  }
  return tracklist;
}

/* Finds closest song on last.fm given a searchstring (trackname)
*
* @param trackname - searchstring for last.fm searches
* @return          - returns object that implements .name and .artist
*/
async function searchTrack(trackname) {
  const searchQuery = "http://ws.audioscrobbler.com/2.0/?method=track.search"
                      + "&track=" + escape(trackname)
                      + "&api_key=" + LAST_FM_API_KEY
                      + "&format=json"
                      + "&limit=1";
  const response = await fetch(searchQuery);
  const myJson = await response.json();
  return {
    name: myJson.results.trackmatches.track[0].name,
    artist: myJson.results.trackmatches.track[0].artist
  };
}

/* creates a new unlisted Playlist in youtube based on youtubes search and the given found_tracklist
*
* @param tracklist - array of track objects
* @return          - void
*/
async function createUnlistedPlaylist(tracklist) {
  //Load gapi
  await new Promise((resolve,reject) => {gapi.load("client", resolve);});
  //Load youtube client api
  await loadClient();
  //perform youtube search
  if (LOGGING) console.log("Searching for youtube videos...");
  var videoIds = await getVideoIds(tracklist, MAX_PLAYLIST_LENGTH);
  if (LOGGING) console.log("Searching youtube for videoIds finished");
  //create link to youtube playlist
  var URL_YOUTUBE_PLAYLIST = "https://www.youtube.com/watch_videos?video_ids=";
  for (var i = 0; i < videoIds.length; i++){
    URL_YOUTUBE_PLAYLIST += videoIds[i] + ","
  }

  //open youtube playlist in new tab
  chrome.tabs.create({"url": URL_YOUTUBE_PLAYLIST});
}

/* Uses youtube search to find videoId based on songname and artist
* Todo: Correct implementation with Promise.all()
*
* @param tracklist - Array of track objects
* @param maxCountVideoIds - Old parameter should be remove that caps youtube queries for api-limit reasons
* @return         - string array of videoIds
*/
async function getVideoIds(tracklist, maxCountVideoIds) {

  var videoIds = new Array(maxCountVideoIds);
  var startedQueries = [];

  //Search youtube for tracknames in parallel
  if (LOGGING) console.log("Initializing new youtube search queries");
  for (var i = 0; i < Math.min(maxCountVideoIds,tracklist.length); i++) {
    startedQueries.push(queryYoutubeSearch(tracklist, videoIds, i));
  };

  //Wait in function for all youtube searches to finish
  if (LOGGING) console.log("Waiting for youtube search queries to finish...");
  for (var i = 0; i < startedQueries.length; i++) {
      await startedQueries[i];
  }
  return videoIds;
}

/* executes one youtube search query for song tracklist[trackIndex]
*  should be refactored with getVideoIds in a Promise.All
*
*
*/
function queryYoutubeSearch(tracklist, videoIds, trackIndex){
    const MAX_YOUTUBE_SEARCH_RESULTS = 3;
    const forbiddenKeyWords = ["(live)", "(live ", " live)", "(Live ", " Live)", "(Live)", " Live "];

    var searchstring = tracklist[trackIndex].name + " " + tracklist[trackIndex].artist;
    return gapi.client.youtube.search.list({
      "part": "snippet",
      "maxResults": MAX_YOUTUBE_SEARCH_RESULTS,
      "q": searchstring
      })
      .then(function(response) {
        // Handle Youtube search result and append youtube videoId to videoIds
        // Search for the most relevant video that has doesnt contain one of the forbiddenKeyWords in description or title
        var videos = response.result.items;
        var bestvideo = videos[0];
        for (var i = 0; i < videos.length; i++){
          if (!forbiddenKeyWords.some((keyword) => videos[i].snippet.description.includes(keyword)
                                                || videos[i].snippet.title.includes(keyword))) {
            bestvideo = videos[i];
            break;
          }
        }
        videoIds[trackIndex] = bestvideo.id.videoId;
        if (LOGGING) console.log("Found VideoId for:" + searchstring + "  :  "  +  bestvideo.id.videoId);
        },
        function(err) { console.error("Execute error", err); });
}
