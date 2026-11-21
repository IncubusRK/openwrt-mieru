#
# Copyright (C) 2026 IncubusRK
#
# This is free software, licensed under the GNU General Public License v2
# or later. See /LICENSE for more information.
#
# Upstream mieru is licensed under GPL-3.0-or-later (see PKG_LICENSE below).
#

include $(TOPDIR)/rules.mk

PKG_NAME:=mieru
PKG_VERSION:=3.39.0
PKG_RELEASE:=1

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/enfein/mieru/tar.gz/v$(PKG_VERSION)?
PKG_HASH:=434198ea0558bc440379e9a0a97f6904ba8dd6b213dd6fb9d578388eba7d2f12

PKG_MAINTAINER:=IncubusRK <incubusrk@users.noreply.github.com>
PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE

PKG_BUILD_DIR:=$(BUILD_DIR)/mieru-$(PKG_VERSION)
PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/enfein/mieru/v3
GO_PKG_BUILD_PKG:=github.com/enfein/mieru/v3/cmd/mieru
GO_PKG_LDFLAGS:=-s -w

# mieru is pure Go (no `import "C"` anywhere); force CGO off so the build
# does not depend on the target libc/assembly (works on mips softfloat etc.)
GO_PKG_VARS+=CGO_ENABLED=0

include $(INCLUDE_DIR)/package.mk
# The monorepo is cloned into package/openwrt-mieru, so the golang feed
# helpers must be referenced via $(TOPDIR), not a relative path.
include $(TOPDIR)/feeds/packages/lang/golang/golang-package.mk

define Package/mieru
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Web Servers/Proxies
  TITLE:=Mieru proxy client (SOCKS5/HTTP, TCP or UDP)
  URL:=https://github.com/enfein/mieru
  DEPENDS:=$(GO_ARCH_DEPENDS)
endef

define Package/mieru/description
  Mieru is a secure, hard to classify, hard to probe, TCP or UDP
  protocol-based SOCKS5 / HTTP / HTTPS network proxy client.
  It uses XChaCha20-Poly1305 encryption keyed by username, password
  and system time, random padding and replay attack detection.
  This package provides the client binary, a UCI configuration and
  a procd init script with multi-port / port-range bindings.
endef

define Package/mieru/conffiles
/etc/config/mieru
endef

define Package/mieru/install
	$(call GoPackage/Package/Install/Bin,$(1))

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/mieru.config $(1)/etc/config/mieru

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/mieru.init $(1)/etc/init.d/mieru
endef

$(eval $(call GoBinPackage,mieru))
$(eval $(call BuildPackage,mieru))