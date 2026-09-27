-- =====================================================================
-- 0002 enums (SPEC §4.9 and the inline enums of §4.1–§4.8)
-- =====================================================================

create type public.org_type as enum ('operator', 'dealer', 'owner', 'financier', 'insurer', 'authority', 'inspector', 'marketplace', 'manufacturer', 'client');
create type public.org_status as enum ('pending', 'approved', 'suspended');
create type public.member_role as enum ('admin', 'member', 'readonly');
create type public.membership_status as enum ('invited', 'active', 'removed');
create type public.operator_role as enum ('superadmin', 'verifier', 'support');

create type public.machine_category as enum (
  'excavator_tracked', 'excavator_wheeled', 'wheel_loader', 'backhoe', 'dumper', 'dozer', 'grader', 'roller', 'paver',
  'crane_mobile', 'telehandler', 'forklift', 'tractor', 'forestry_harvester', 'forestry_forwarder', 'skidder', 'drill_rig',
  'crusher', 'screener', 'generator', 'compressor', 'trailer_heavy', 'attachment', 'other');
create type public.fuel_type as enum ('diesel', 'hvo', 'petrol', 'gas', 'electric', 'hybrid', 'hydrogen', 'other', 'unknown');
create type public.electric_config as enum ('battery', 'cable', 'battery_and_cable', 'fuel_cell', 'plugin_hybrid');
create type public.emission_stage as enum ('pre_stage', 'stage_i', 'stage_ii', 'stage_iiia', 'stage_iiib', 'stage_iv', 'stage_v', 'zero_emission', 'unknown');
create type public.power_standard as enum ('iso_14396', 'ece_r120', 'sae_j1349', 'other');
create type public.registration_type as enum ('permanent', 'temporary');
create type public.machine_status as enum ('draft', 'active', 'stolen', 'blocked', 'disputed', 'scrapped', 'exported', 'deregistered');
create type public.verification_method as enum ('documents', 'physical', 'new_sale');
create type public.machine_origin as enum ('new_sale', 'retro', 'import', 'transfer_in');
create type public.model_source as enum ('manual', 'imported', 'ml_list');

create type public.identifier_type as enum ('pin', 'serial', 'engine_serial', 'vin', 'road_reg', 'external_registry', 'chassis', 'other');
create type public.identifier_source as enum ('nameplate_ocr', 'manual', 'invoice', 'import', 'api', 'vtr_lookup', 'oem');
create type public.acquired_via as enum ('registration', 'transfer', 'import', 'correction');

create type public.label_status as enum ('printed', 'assigned', 'bound', 'revoked', 'lost');
create type public.label_role as enum ('primary', 'secondary');
create type public.label_medium as enum ('qr', 'nfc');
create type public.label_batch_status as enum ('ordered', 'printed', 'shipped', 'cancelled');

create type public.encumbrance_type as enum ('ownership_reservation', 'leasing', 'rental', 'other');
create type public.encumbrance_status as enum ('pending', 'active', 'released', 'rejected', 'transferred');
create type public.transfer_status as enum ('draft', 'awaiting_buyer', 'awaiting_financier', 'completed', 'cancelled', 'expired');
create type public.flag_type as enum ('stolen', 'seized', 'blocked', 'under_investigation', 'disputed', 'scrapped', 'exported');
create type public.flag_status as enum ('active', 'cleared');
create type public.deregistration_reason as enum ('scrapped', 'exported', 'misregistered', 'military', 'stolen_not_recovered', 'other');

create type public.verification_request_status as enum ('open', 'in_review', 'approved', 'rejected', 'needs_info');
create type public.conflict_type as enum ('duplicate_identifier', 'double_encumbrance', 'ownership_dispute', 'market_anomaly', 'label_reuse');
create type public.conflict_status as enum ('open', 'resolved', 'dismissed');
create type public.signature_provider as enum ('bankid', 'mock');
create type public.signature_status as enum ('pending', 'completed', 'failed', 'cancelled');

create type public.document_type as enum (
  'invoice', 'purchase_agreement', 'financing_contract', 'ce_declaration', 'manual', 'insurance_policy', 'inspection_report',
  'photo_nameplate', 'photo_machine', 'photo_label', 'police_report', 'ownership_certificate', 'check_receipt',
  'buyer_report', 'fleet_report', 'register_extract', 'climate_report', 'power_of_attorney', 'other');
create type public.document_visibility as enum ('owner', 'owner_and_financier', 'verifiers', 'public');
create type public.actor_type as enum ('user', 'system', 'api');
create type public.viewer_type as enum ('public', 'owner', 'dealer', 'financier', 'insurer', 'authority', 'inspector', 'operator', 'api', 'client', 'manufacturer', 'marketplace');
create type public.access_via as enum ('web', 'scan', 'api', 'share_link', 'check');
create type public.share_scope as enum ('public_card', 'buyer_report', 'fleet_report', 'project_list');

create type public.maintenance_type as enum ('service', 'repair', 'inspection', 'hour_reading', 'other');
create type public.inspection_type as enum ('first', 'periodic', 'revision', 'extraordinary');
create type public.inspection_result as enum ('approved', 'approved_with_remarks', 'rejected');
create type public.reminder_type as enum ('service', 'inspection', 'insurance', 'lease_end', 'encumbrance_end', 'temporary_registration_end', 'rental_end', 'custom');
create type public.reminder_status as enum ('open', 'done', 'snoozed');
create type public.rental_status as enum ('planned', 'active', 'returned', 'overdue');
create type public.insurance_coverage as enum ('liability', 'machine', 'theft', 'full');
create type public.insurance_status as enum ('active', 'expired', 'cancelled');
create type public.import_status as enum ('uploaded', 'mapped', 'validated', 'committed', 'failed');
create type public.import_row_status as enum ('pending', 'ok', 'error', 'skipped');

create type public.market_tos_status as enum ('unknown', 'allowed', 'partner_feed', 'restricted');
create type public.seller_type as enum ('business', 'private', 'unknown');
create type public.serial_source as enum ('listing_text', 'image_ocr', 'feed');
create type public.market_alert_type as enum ('duplicate_serial_in_market', 'stolen_machine_listed', 'listed_with_active_financing', 'listed_after_transfer', 'price_anomaly', 'seller_not_owner');
create type public.market_alert_status as enum ('open', 'reviewed', 'dismissed', 'escalated');
create type public.oem_source as enum ('api', 'import');

create type public.notification_severity as enum ('info', 'warning', 'critical');
create type public.notification_channel as enum ('inapp', 'email', 'sms', 'push');
create type public.digest_mode as enum ('instant', 'daily', 'weekly');
create type public.webhook_delivery_status as enum ('pending', 'delivered', 'failed');
