# Access by local hostname

For this installation, use **http://findstuff.local:8000/**. The hostname does not
remove the port: entering only `http://findstuff.local/` requests port 80, where
Findstuff does not listen by default.

The Docker port mapping makes the application reachable by IP. Advertising a
`.local` name is a separate host service. A Docker container named `findstuff`
does not automatically advertise `findstuff.local` to other PCs.

On a Linux host with Avahi installed, run:

```sh
sudo ./scripts/configure-local-hostname.sh
avahi-resolve-host-name -4 findstuff.local
curl --noproxy '*' -I http://findstuff.local:8000/
```

The script sets Avahi's advertised hostname to `findstuff`, retains the original
configuration at `/etc/avahi/avahi-daemon.conf.before-findstuff`, and restarts
Avahi. The operating-system hostname remains unchanged. Its previous `.local`
name is replaced. Avahi advertises current interface addresses, so this does not
pin a possibly changing DHCP address in a hosts file.

This uses Avahi's documented [`host-name` setting](https://github.com/avahi/avahi/blob/master/man/avahi-daemon.conf.5.xml.in).

If IP access works but the name still fails from another device, check that the
client supports mDNS and is on the same LAN without guest isolation or multicast
filtering. Do not change the application bind address when IP access already
works. A hostname collision causes Avahi to choose a suffixed name; inspect
`journalctl -u avahi-daemon` if resolution differs from the configured name.

To restore the original advertised hostname:

```sh
sudo cp /etc/avahi/avahi-daemon.conf.before-findstuff /etc/avahi/avahi-daemon.conf
sudo systemctl restart avahi-daemon
```
