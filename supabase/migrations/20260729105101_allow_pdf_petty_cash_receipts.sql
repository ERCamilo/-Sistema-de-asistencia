alter table public.petty_cash_receipts
    drop constraint if exists petty_cash_receipts_mime_type_check,
    drop constraint if exists petty_cash_receipts_file_size_bytes_check;

alter table public.petty_cash_receipts
    add column if not exists page_count smallint,
    add constraint petty_cash_receipts_mime_type_check
        check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    add constraint petty_cash_receipts_file_size_bytes_check
        check (file_size_bytes is null or file_size_bytes between 1 and 10485760),
    add constraint petty_cash_receipts_page_count_check
        check (page_count is null or page_count between 1 and 10);

update storage.buckets
set
    file_size_limit = 10485760,
    allowed_mime_types = array[
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf'
    ]
where id = 'petty-cash-receipts';

comment on column public.petty_cash_receipts.page_count is
    'Number of PDF pages detected locally when available; limited to ten.';
