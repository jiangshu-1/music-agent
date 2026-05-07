import ssdp from 'node-ssdp';
const { Client } = ssdp;
import DeviceClient from 'upnp-device-client';

let currentDevice = null;

export function discoverDevices() {
  const client = new Client();
  
  client.on('response', (headers, statusCode, rinfo) => {
    if (headers.ST === 'urn:schemas-upnp-org:device:MediaRenderer:1') {
      console.log('Found MediaRenderer:', headers.LOCATION);
      currentDevice = new DeviceClient(headers.LOCATION);
    }
  });

  client.search('urn:schemas-upnp-org:device:MediaRenderer:1');
}

export async function playOnDevice(url, metadata = {}) {
  if (!currentDevice) {
    console.log('No UPnP device found yet');
    return;
  }

  return new Promise((resolve, reject) => {
    currentDevice.callAction('AVTransport', 'SetAVTransportURI', {
      InstanceID: 0,
      CurrentURI: url,
      CurrentURIMetaData: metadata.xml || ''
    }, (err) => {
      if (err) return reject(err);
      
      currentDevice.callAction('AVTransport', 'Play', {
        InstanceID: 0,
        Speed: 1
      }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

// Auto discover on start
discoverDevices();
