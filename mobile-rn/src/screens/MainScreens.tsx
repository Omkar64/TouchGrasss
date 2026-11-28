import React from 'react';
import { GatekeeperScreen } from './GatekeeperScreen';
import { RequestPassScreen } from './RequestPassScreen';
import { LawnScreen } from './LawnScreen';
import { ProfileScreen } from './ProfileScreen';
import { SquadScreen } from './SquadScreen';
import { TodayScreen } from './TodayScreen';
import type { MainScreensProps, ScreenProps } from './types';

// This component chooses the active page and derives the common Gatekeeper lists once.
export function MainScreens(props: MainScreensProps) {
  const { requests, session, connections, subpage, tab } = props;
  const userId = session.user.id;
  // Each request can be relevant as either a requester's own item or an inbox item.
  const userRequests = requests.filter(request => request.requester_id === userId || request.gatekeeper_id === userId);
  const primaryConnection = connections.find(connection => connection.requester_id === userId);
  const inbox = userRequests.filter(request => request.gatekeeper_id === userId && request.status === 'pending');
  const mine = userRequests.filter(request => request.requester_id === userId).slice(0, 3);
  const overseenCount = connections.filter(connection => connection.gatekeeper_id === userId).length;
  const shared: ScreenProps = { ...props, primaryConnection };

  if (subpage === 'request') return <RequestPassScreen {...shared} />;
  if (subpage === 'gatekeeper') return <GatekeeperScreen {...shared} inbox={inbox} overseenCount={overseenCount} />;

  switch (tab) {
    case 'Today': return <TodayScreen {...shared} mine={mine} />;
    case 'The Lawn': return <LawnScreen {...shared} />;
    case 'Squad': return <SquadScreen {...shared} />;
    default: return <ProfileScreen {...shared} />;
  }
}
