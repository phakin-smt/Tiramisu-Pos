"""Look at and change the shops this deployment serves.

    python backend/manage_stores.py list
    python backend/manage_stores.py rename 1 "พร้อมตัก" --code promtak
    python backend/manage_stores.py add promtom "พร้อมต้ม"
    python backend/manage_stores.py logo 1 /logos/promtak.png
    python backend/manage_stores.py pricing 2 --bundle 120:3:330
    python backend/manage_stores.py pricing 2 --clear

Nothing here deletes a store or touches a sale. Deactivating is the way to
retire one, because its orders, stock movements and closures stay attached to it
for good.

Adding the second store is the moment staff start being asked which shop they
are ringing up for, in both the app at / and the one at /next/. Until then the
only store is chosen for them and no one sees a picker. Run it outside trading
hours, and tell the people at the tills first.
"""

import argparse
import sys
from pathlib import Path

from database import connect_db, execute, is_postgres, transaction


# Store names are Thai, and a Windows console defaults to cp1252, which cannot
# encode them. Without this the tool does its work and then dies on the report.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, 'reconfigure'):
        _stream.reconfigure(encoding='utf-8', errors='replace')


def rows(query, params=()):
    connection = connect_db()
    try:
        return execute(connection.cursor(), query, params).fetchall()
    finally:
        connection.close()


def show(_args):
    listed = rows('SELECT id, code, name, is_active, logo_url, bundle_unit_price, bundle_quantity,'
                  ' bundle_price, wholesale_category, wholesale_discount FROM stores ORDER BY id')
    if not listed:
        print('No stores yet.')
        return 0
    for store in listed:
        state = 'active' if store['is_active'] else 'inactive'
        print('[{}] {} ({}) - {}'.format(store['id'], store['name'], store['code'], state))
        print('      logo: {}'.format(store['logo_url'] or 'none, shows initials'))
        if store['bundle_unit_price'] is not None:
            print('      bundle: {} x {} for {}'.format(
                store['bundle_unit_price'], store['bundle_quantity'], store['bundle_price']))
        if store['wholesale_category']:
            print('      wholesale: {} off each {}'.format(
                store['wholesale_discount'], store['wholesale_category']))
        if store['bundle_unit_price'] is None and not store['wholesale_category']:
            print('      no automatic discount')
    active = sum(1 for store in listed if store['is_active'])
    print()
    print('{} active store(s). {}'.format(
        active,
        'Staff are asked to choose one.' if active > 1 else 'The only one is chosen for them.'))
    return 0


def rename(args):
    with transaction() as (_, cursor):
        found = execute(cursor, 'SELECT id FROM stores WHERE id=?', (args.store_id,)).fetchone()
        if not found:
            print('No store with id {}'.format(args.store_id), file=sys.stderr)
            return 1
        if args.code:
            execute(cursor, 'UPDATE stores SET code=?, name=? WHERE id=?',
                    (args.code, args.name, args.store_id))
        else:
            execute(cursor, 'UPDATE stores SET name=? WHERE id=?', (args.name, args.store_id))
    print('Store {} is now "{}".'.format(args.store_id, args.name))
    return 0


def add(args):
    with transaction() as (_, cursor):
        clash = execute(cursor, 'SELECT id FROM stores WHERE code=?', (args.code,)).fetchone()
        if clash:
            print('Code "{}" already belongs to store {}'.format(args.code, clash['id']), file=sys.stderr)
            return 1
        # No automatic discount to begin with. A shop gets promotions when
        # someone decides what they should be, never by inheriting another's.
        query = 'INSERT INTO stores (code, name) VALUES (?,?)' + (' RETURNING id' if is_postgres() else '')
        result = execute(cursor, query, (args.code, args.name))
        store_id = result.fetchone()['id'] if is_postgres() else cursor.lastrowid
        active = execute(cursor, 'SELECT COUNT(*) total FROM stores WHERE is_active=1').fetchone()['total']
    print('Added store {} "{}" ({}), with no automatic discount.'.format(store_id, args.name, args.code))
    print('Add its menu by signing in, choosing it, and using the product screen.')
    if active > 1:
        print()
        print('There are now {} active stores, so every sign-in asks which one.'.format(active))
    return 0


LOGO_PREFIX = '/logos/'


def logo(args):
    if not args.clear:
        # Some shells rewrite a leading slash into a filesystem path. Catching it
        # here beats storing something the browser can never fetch.
        if not args.url:
            print('Give the path to the logo, or pass --clear.', file=sys.stderr)
            return 1
        if not args.url.startswith(LOGO_PREFIX):
            print('Expected a path beginning "{}", got "{}".'.format(LOGO_PREFIX, args.url), file=sys.stderr)
            print('The file belongs in public/logos, and the value is what the browser asks for.',
                  file=sys.stderr)
            return 1
        served = Path(__file__).resolve().parent.parent / 'public' / 'logos' / args.url[len(LOGO_PREFIX):]
        if not served.is_file():
            print('No such file: {}'.format(served), file=sys.stderr)
            return 1
    with transaction() as (_, cursor):
        found = execute(cursor, 'SELECT id FROM stores WHERE id=?', (args.store_id,)).fetchone()
        if not found:
            print('No store with id {}'.format(args.store_id), file=sys.stderr)
            return 1
        # Stored as the path the browser asks for, not a filesystem location, so
        # the same row works from any machine serving the app.
        execute(cursor, 'UPDATE stores SET logo_url=? WHERE id=?',
                (None if args.clear else args.url, args.store_id))
    print('Cleared the logo for store {}.'.format(args.store_id) if args.clear
          else 'Store {} now shows {}.'.format(args.store_id, args.url))
    return 0


def parse_bundle(value):
    parts = value.split(':')
    if len(parts) != 3:
        raise argparse.ArgumentTypeError('use unitPrice:quantity:price, for example 69:3:200')
    try:
        return float(parts[0]), int(parts[1]), float(parts[2])
    except ValueError:
        raise argparse.ArgumentTypeError('bundle values must be numbers') from None


def parse_wholesale(value):
    category, _, discount = value.partition(':')
    if not category or not discount:
        raise argparse.ArgumentTypeError('use category:discount, for example Tiramisu:9')
    try:
        return category, float(discount)
    except ValueError:
        raise argparse.ArgumentTypeError('the discount must be a number') from None


def pricing(args):
    if not args.clear and not args.bundle and not args.wholesale:
        print('Nothing to change. Pass --bundle, --wholesale or --clear.', file=sys.stderr)
        return 1
    with transaction() as (_, cursor):
        found = execute(cursor, 'SELECT id FROM stores WHERE id=?', (args.store_id,)).fetchone()
        if not found:
            print('No store with id {}'.format(args.store_id), file=sys.stderr)
            return 1
        if args.clear:
            execute(cursor, 'UPDATE stores SET bundle_unit_price=NULL, bundle_quantity=NULL,'
                            ' bundle_price=NULL, wholesale_category=NULL, wholesale_discount=NULL'
                            ' WHERE id=?', (args.store_id,))
        if args.bundle:
            unit_price, quantity, price = args.bundle
            execute(cursor, 'UPDATE stores SET bundle_unit_price=?, bundle_quantity=?, bundle_price=?'
                            ' WHERE id=?', (unit_price, quantity, price, args.store_id))
        if args.wholesale:
            category, discount = args.wholesale
            execute(cursor, 'UPDATE stores SET wholesale_category=?, wholesale_discount=? WHERE id=?',
                    (category, discount, args.store_id))
    print('Updated pricing for store {}.'.format(args.store_id))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)

    commands.add_parser('list', help='show every store and its pricing').set_defaults(run=show)

    renamer = commands.add_parser('rename', help='change a store name, and optionally its code')
    renamer.add_argument('store_id', type=int)
    renamer.add_argument('name')
    renamer.add_argument('--code')
    renamer.set_defaults(run=rename)

    adder = commands.add_parser('add', help='create a store with no automatic discount')
    adder.add_argument('code')
    adder.add_argument('name')
    adder.set_defaults(run=add)

    logos = commands.add_parser('logo', help='point a store at its mark, or remove it')
    logos.add_argument('store_id', type=int)
    logos.add_argument('url', nargs='?', help='the path the browser requests, e.g. /logos/promtak.png')
    logos.add_argument('--clear', action='store_true')
    logos.set_defaults(run=logo)

    prices = commands.add_parser('pricing', help='set or clear a store automatic discounts')
    prices.add_argument('store_id', type=int)
    prices.add_argument('--bundle', type=parse_bundle, metavar='UNIT:QTY:PRICE')
    prices.add_argument('--wholesale', type=parse_wholesale, metavar='CATEGORY:DISCOUNT')
    prices.add_argument('--clear', action='store_true')
    prices.set_defaults(run=pricing)

    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == '__main__':
    sys.exit(main())
