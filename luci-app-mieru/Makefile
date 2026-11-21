#
# Copyright (C) 2026 IncubusRK
#
# This is free software, licensed under the GNU General Public License v2
# or later. See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-mieru
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

LUCI_TITLE:=LuCI support for the Mieru proxy client
LUCI_DEPENDS:=+luci-base +mieru +rpcd +ucode
LUCI_PKGARCH:=all

PKG_LICENSE:=GPL-2.0-or-later
PKG_MAINTAINER:=IncubusRK <incubusrk@users.noreply.github.com>

include $(TOPDIR)/feeds/luci/luci.mk

# luci.mk evaluates BuildPackage for luci-app-mieru and the luci-i18n-mieru-*
# translation packages automatically (LUCI_LANGUAGES is derived from po/).