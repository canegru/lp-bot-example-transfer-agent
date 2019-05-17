'use strict';

/*
 * This demo try to use most of the API calls of the mssaging agent api. It:
 *
 * 1) Registers the agent as online
 * 2) Accepts any routing task (== ring)
 * 3) Publishes to the conversation the consumer info when it gets new conversation
 * 4) Gets the content of the conversation
 * 5) Emit 'MyCoolAgent.ContentEvnet' to let the developer handle contentEvent responses
 * 6) Mark as 'read' the handled messages
 *
 */

const Agent = require('./../../lib/AgentSDK');
const jsonfile = require('jsonfile');
let globalcounterbs = 0;

class MyCoolAgent extends Agent {
    constructor(conf) {
        super(conf);
        this.conf = conf;
        this.init();
        this.CONTENT_NOTIFICATION = 'MyCoolAgent.ContentEvnet';
        this.consumerId = undefined;
    }

    init() {
        let openConvs = {};

        this.on('connected', msg => {
            console.log('connected...', this.conf.id || '', msg);
            this.setAgentState({ availability: 'ONLINE' });
            this.subscribeExConversations({
                'agentIds': [this.agentId],
                'convState': ['OPEN']
            }, (e, resp) => console.log('subscribeExConversations', this.conf.id || '', resp || e));
            this.subscribeRoutingTasks({});
            this._pingClock = setInterval(this.getClock, 30000);
        });

        // Accept any routingTask (==ring)
        this.on('routing.RoutingTaskNotification', body => {
            body.changes.forEach(c => {
                if (c.type === 'UPSERT') {
                    c.result.ringsDetails.forEach(r => {
                        if (r.ringState === 'WAITING') {
                            this.updateRingState({
                                'ringId': r.ringId,
                                'ringState': 'ACCEPTED'
                            }, (e, resp) => console.log(resp));
                        }
                    });
                }
            });
        });

        // Notification on changes in the open consversation list
        this.on('cqm.ExConversationChangeNotification', notificationBody => {
            console.log('starting')
            notificationBody.changes.forEach(change => {
                globalcounterbs += 1;
                console.log('change occured===============>')
                jsonfile.writeFile(`./debug/${change.result.convId}-${globalcounterbs}.json`, change)
                    .then(res => {
                        console.log('Write complete')
                    })
                    .catch(error => console.error(error))

                if (change.type === 'UPSERT') {
                    // new conversation for me
                    openConvs[change.result.convId] = {};

                    // demonstraiton of using the consumer profile calls
                    this.consumerId = change.result.conversationDetails.participants.filter(p => p.role === 'CONSUMER')[0].id;
                    if (!openConvs[change.result.convId]) {
                        this.getUserProfile(this.consumerId, (e, profileResp) => {
                            this.publishEvent({
                                dialogId: change.result.convId,
                                event: {
                                    type: 'ContentEvent',
                                    contentType: 'text/plain',
                                    message: `Just joined to conversation with TransferBot, transfering you`
                                }
                            });
                        });
                    }

                    const transferSkillId = '552294713';
                    //const transferSkillId = '1099474414';
                    const targetSkillId = '773664730';
                    //const targetSkillId = '1130355214';

                    const cnegruId = '737250630';
                    const cnegruIdHash = 'c1225f09-1c88-511e-918a-aafe51c99624';
                    const tId = '3fef0478-69e6-55cd-8a15-908fde1d732a';

                    console.log(change.result.conversationDetails.skillId)
                    console.log(change.result.conversationDetails.dialogs[0].participantsDetails)

                    if (change.result.conversationDetails.skillId === transferSkillId) {
                        this.updateConversationField({
                            'conversationId': change.result.convId,
                            'conversationField': [
                                {
                                    'field': 'ParticipantsChange',
                                    'type': 'REMOVE',
                                    'role': 'ASSIGNED_AGENT'
                                }, {
                                    'field': 'ParticipantsChange',
                                    'type': 'SUGGEST',
                                    'userId': cnegruIdHash,
                                    'role': 'ASSIGNED_AGENT'
                                }, {
                                    'field': 'Skill',
                                    'type': 'UPDATE',
                                    'skill': targetSkillId
                                }
                            ]
                        }, (e, resp) => {
                            if (e) { console.error(e) }
                            console.log(resp)
                        });
                    }



                    this.subscribeMessagingEvents({ dialogId: change.result.convId });
                } else if (change.type === 'UPSERT' && openConvs[change.result.convId] && change.result.conversationDetails.participants.filter(p => p.role === 'CONSUMER')[0].id !== this.consumerId) {
                    // ConsumerID changed. Typically, a Step Up from an unauthenticated to an authenticated user.
                    this.consumerId = change.result.conversationDetails.participants.filter(p => p.role === 'CONSUMER')[0].id;
                    this.getUserProfile(this.consumerId, (e, profileResp) => {
                        this.publishEvent({
                            dialogId: change.result.convId,
                            event: {
                                type: 'ContentEvent',
                                contentType: 'text/plain',
                                message: `Consumer stepped up in conversation with ${JSON.stringify(profileResp)}`
                            }
                        });
                    });
                } else if (change.type === 'DELETE') {
                    // conversation was closed or transferred
                    delete openConvs[change.result.convId];
                }
            });
        });

        // Echo every unread consumer message and mark it as read
        this.on('ms.MessagingEventNotification', body => {
            const respond = {};
            body.changes.forEach(c => {
                // In the current version MessagingEventNotification are recived also without subscription
                // Will be fixed in the next api version. So we have to check if this notification is handled by us.
                if (openConvs[c.dialogId]) {
                    // add to respond list all content event not by me
                    if (c.event.type === 'ContentEvent' && c.originatorId !== this.agentId) {
                        respond[`${body.dialogId}-${c.sequence}`] = {
                            dialogId: body.dialogId,
                            sequence: c.sequence,
                            message: c.event.message
                        };
                    }
                    // remove from respond list all the messages that were already read
                    if (c.event.type === 'AcceptStatusEvent' && c.originatorId === this.agentId) {
                        c.event.sequenceList.forEach(seq => {
                            delete respond[`${body.dialogId}-${seq}`];
                        });
                    }
                }
            });

            // publish read, and echo
            Object.keys(respond).forEach(key => {
                let contentEvent = respond[key];
                this.publishEvent({
                    dialogId: contentEvent.dialogId,
                    event: { type: 'AcceptStatusEvent', status: 'READ', sequenceList: [contentEvent.sequence] }
                });
                this.emit(this.CONTENT_NOTIFICATION, contentEvent);
            });
        });

        // Tracing
        //this.on('notification', msg => console.log('got message', msg));
        this.on('error', err => console.log('got an error', err));
        this.on('closed', data => {
            // For production environments ensure that you implement reconnect logic according to
            // liveperson's retry policy guidelines: https://developers.liveperson.com/guides-retry-policy.html
            console.log('socket closed', data);
            clearInterval(this._pingClock);
        });
    }
}

module.exports = MyCoolAgent;
