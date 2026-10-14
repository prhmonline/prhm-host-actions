"""Offline review gates: review artifacts never mutate libvirt/firewalld."""
import ipaddress
import pathlib
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent

class SharedCINetworkContractTests(unittest.TestCase):
    def test_ci_libvirt_is_independent_nat(self):
        text = (ROOT / "ci-net.xml.review").read_text()
        xml = ET.fromstring(text)
        self.assertEqual(xml.findtext("name"), "ci-net")
        self.assertEqual(xml.find("forward").attrib["mode"], "nat")
        self.assertEqual(xml.find("bridge").attrib["name"], "virbr-ci")
        ip = xml.find("ip")
        self.assertEqual(ip.attrib["address"], "10.72.0.1")
        self.assertEqual(ip.attrib["netmask"], "255.255.255.0")
        leases = ip.find("dhcp").find("range").attrib
        net = ipaddress.ip_network("10.72.0.0/24")
        self.assertTrue(all(ipaddress.ip_address(leases[k]) in net for k in ("start", "end")))
        self.assertIsNone(xml.find("domain"))
        self.assertNotIn("virbr-prod", text)
        self.assertNotIn("10.71.0.118", text)

    def test_firewall_scope_only_dedicated_bridge(self):
        text = (ROOT / "ci-isolation.nft.review").read_text()
        self.assertIn("table inet prhm_ci_isolation", text)
        self.assertIn('iifname "virbr-ci"', text)
        self.assertIn('oifname "virbr-ci"', text)
        for command in ("flush ruleset", "delete table", "flush chain", "add chain"):
            self.assertNotIn(command + " ", text.replace("#", ""))
        self.assertNotIn('iifname "virbr-prod"', text)
        self.assertNotIn('oifname "virbr-prod"', text)
        self.assertIn("priority -195", text)

    def test_nonpublic_and_production_ranges_are_blocked(self):
        text = (ROOT / "ci-isolation.nft.review").read_text()
        for cidr in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
                     "127.0.0.0/8", "169.254.0.0/16", "100.64.0.0/10",
                     "185.191.76.136/30"):
            self.assertIn(cidr, text)
        self.assertLess(text.index('ip daddr @denied_ipv4 drop'),
                        text.index('meta nfproto ipv4 tcp dport 443 accept'))
        self.assertIn('iifname "virbr-ci" drop', text)
        self.assertIn('oifname "virbr-ci" drop', text)

    def test_no_ipv6_escape_and_no_host_ssh(self):
        text = (ROOT / "ci-isolation.nft.review").read_text()
        self.assertGreaterEqual(text.count('meta nfproto ipv6 drop'), 3)
        self.assertIn('ip daddr 10.72.0.1 udp sport 68 udp dport 67 accept', text)
        self.assertIn('ip daddr 10.72.0.1 udp dport 53 accept', text)
        self.assertIn('ip daddr 10.72.0.1 tcp dport 53 accept', text)
        self.assertNotIn('tcp dport 22 accept', text)

if __name__ == '__main__':
    unittest.main()
