DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS messages CASCADE;

CREATE TABLE channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    tenant_id UUID NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_channel_id ON messages(channel_id, tenant_id);

-- Insert new channels
INSERT INTO channels (tenant_id, name) VALUES ('5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'General');
INSERT INTO channels (tenant_id, name) VALUES ('5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'Support');
INSERT INTO channels (tenant_id, name) VALUES ('5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'Sales');
INSERT INTO channels (tenant_id, name) VALUES ('208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'General');
INSERT INTO channels (tenant_id, name) VALUES ('208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Design');
INSERT INTO channels (tenant_id, name) VALUES ('208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Deliveries');


-- Get channel IDs dynamically
DO $$
DECLARE
    general_channel_wisdom UUID;
    support_channel_wisdom UUID;
    sales_channel_wisdom UUID;
    general_channel_ausbury UUID;
    design_channel_ausbury UUID;
    deliveries_channel_ausbury UUID;
BEGIN
    -- Fetch channel IDs for "Wisdom Co." tenant
    SELECT id INTO general_channel_wisdom FROM channels WHERE tenant_id = '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f' AND name = 'General';
    SELECT id INTO support_channel_wisdom FROM channels WHERE tenant_id = '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f' AND name = 'Support';
    SELECT id INTO sales_channel_wisdom FROM channels WHERE tenant_id = '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f' AND name = 'Sales';

    -- Fetch channel IDs for "Ausbury Inc." tenant
    SELECT id INTO general_channel_ausbury FROM channels WHERE tenant_id = '208de300-7cd1-4aa4-a2aa-4dafa4e303dd' AND name = 'General';
    SELECT id INTO design_channel_ausbury FROM channels WHERE tenant_id = '208de300-7cd1-4aa4-a2aa-4dafa4e303dd' AND name = 'Design';
    SELECT id INTO deliveries_channel_ausbury FROM channels WHERE tenant_id = '208de300-7cd1-4aa4-a2aa-4dafa4e303dd' AND name = 'Deliveries';

    -- Insert messages for "General" channel in "Wisdom Co." tenant
    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (general_channel_wisdom, 'fea1a37b-6827-408f-9be8-d878f2fa872f', '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'Welcome to our general discussion channel!', '2025-03-28 09:00:00');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (general_channel_wisdom, '0dff7c44-de06-4ab5-a6ce-3c0a72bc7e21', '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'Thanks Samanta! Looking forward to collaborating here.', '2025-03-28 09:05:23');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (general_channel_wisdom, 'fea1a37b-6827-408f-9be8-d878f2fa872f', '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'Has everyone reviewed the Q1 report?', '2025-03-29 11:30:45');

    -- Insert messages for "Support" channel in "Wisdom Co." tenant
    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (support_channel_wisdom, '0dff7c44-de06-4ab5-a6ce-3c0a72bc7e21', '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'We need to address the ticket backlog this week.', '2025-03-27 14:22:10');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (support_channel_wisdom, 'fea1a37b-6827-408f-9be8-d878f2fa872f', '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'I''ll schedule a triage session for tomorrow morning.', '2025-03-27 14:45:33');

    -- Insert messages for "Sales" channel in "Wisdom Co." tenant
    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (sales_channel_wisdom, 'fea1a37b-6827-408f-9be8-d878f2fa872f', '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'Just closed the deal with Acme Corp! $250K annual contract.', '2025-03-25 16:10:00');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (sales_channel_wisdom, '0dff7c44-de06-4ab5-a6ce-3c0a72bc7e21', '5d4cb3b2-29cc-43e4-952d-b9cb3816ae2f', 'Great work Samanta! That puts us 15% above target for Q1.', '2025-03-25 16:15:22');

    -- Insert messages for "General" channel in "Ausbury Inc." tenant
    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (general_channel_ausbury, '81846e10-109a-4baa-861a-f7cbcb2e545f', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Team meeting scheduled for Friday at 10am.', '2025-03-26 13:00:00');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (general_channel_ausbury, '0dff7c44-de06-4ab5-a6ce-3c0a72bc7e21', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Will the product roadmap discussion be included?', '2025-03-26 13:15:45');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (general_channel_ausbury, '81846e10-109a-4baa-861a-f7cbcb2e545f', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Yes, we''ll allocate 30 minutes for roadmap planning.', '2025-03-26 13:20:18');

    -- Insert messages for "Design" channel in "Ausbury Inc." tenant
    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (design_channel_ausbury, '0dff7c44-de06-4ab5-a6ce-3c0a72bc7e21', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Uploaded the latest UI mockups for the mobile app.', '2025-03-30 10:05:12');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (design_channel_ausbury, '81846e10-109a-4baa-861a-f7cbcb2e545f', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'The color scheme looks great, but can we adjust the navigation bar?', '2025-03-30 10:30:45');

    -- Insert messages for "Deliveries" channel in "Ausbury Inc." tenant
    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (deliveries_channel_ausbury, '81846e10-109a-4baa-861a-f7cbcb2e545f', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Shipment #45982 is delayed due to weather conditions.', '2025-03-29 16:40:00');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (deliveries_channel_ausbury, '0dff7c44-de06-4ab5-a6ce-3c0a72bc7e21', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Let''s notify the client and provide an updated ETA.', '2025-03-29 16:45:33');

    INSERT INTO messages (channel_id, user_id, tenant_id, content, created_at) 
    VALUES (deliveries_channel_ausbury, '81846e10-109a-4baa-861a-f7cbcb2e545f', '208de300-7cd1-4aa4-a2aa-4dafa4e303dd', 'Updated ETA is now Tuesday, I''ve informed the customer.', '2025-03-29 17:00:12');
END $$;